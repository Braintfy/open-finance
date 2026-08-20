// PURPOSE: Диалог «Импорт продаж Wildberries / Яндекс.Маркета» из файла выгрузки
// (docs/STOCK_MODULE_DESIGN.md §12.3 — эти каналы учитываются С ПЕРВОГО ДНЯ, иначе
// остаток своего склада систематически завышается, а план поставок занижается).
//
// ДВА ШАГА ЧЕРЕЗ ОДИН ЭНДПОИНТ POST /api/stock/import/sales:
//   «Разобрать»     — dryRun=1: ничего не пишем, показываем всё, что будет создано;
//   «Импортировать» — dryRun=0: ТОТ ЖЕ файл уходит повторно и сразу проводится.
// Файл держим в состоянии именно ради второго запроса — сервер разбирает его
// заново чистым модулем src/lib/stock/import-sales.ts, второго парсера в браузере
// быть не должно.
//
// ПРЕВЬЮ — ПОЛОВИНА ЦЕННОСТИ ДИАЛОГА. До единой записи в журнал человек видит:
//   • какие колонки файла во что легли («Дата = „Дата продажи“») — не та колонка
//     «Количество» уводит склад молча и на месяцы;
//   • какие дни уже импортированы — это НОРМА, а не ошибка: ключ идемпотентности
//     «канал + дата» (§4.8.9), повторный импорт перекрывающего периода безопасен;
//   • какие позиции не сшиты с номенклатурой — их продажи не попадут ни в склад,
//     ни в себестоимость, и это самая дорогая строка превью.
//
// min-w-0 на корневых контейнерах внутри DialogContent обязателен (blocks.mdc):
// у него display:grid, и длинный артикул иначе распирает модалку.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { formatMoney, stockFetch } from './stock-api';

// ---------------------------------------------------------------------------
// Типы ответа (локально: диалог не должен тянуть серверные модули в бандл)
// ---------------------------------------------------------------------------

type SalesChannel = 'wb' | 'yandex';

const CHANNELS: readonly SalesChannel[] = ['wb', 'yandex'];

const CHANNEL_LABEL: Record<SalesChannel, string> = {
  wb: 'Wildberries',
  yandex: 'Яндекс.Маркет',
};

/** Место списания по умолчанию — свой склад (§12.3). */
const DEFAULT_PLACE_CODE = 'own';

type PlaceOption = {
  id: string;
  code: string;
  name: string;
  authority: string;
  isActive?: boolean;
};

type BalancesResponse = { places: PlaceOption[] };

/** Строка сопоставления «поле → колонка файла». `field` строкой: движок умеет
 *  отдавать и служебный externalSku, которого нет в основном наборе. */
type MappingRow = { field: string; column: number; header: string };

type ImportDoc = {
  date: string;
  kind: 'sale' | 'return_in';
  docId: string | null;
  linesCount: number;
  qtyTotal: number;
  revenueKopecks: number;
  status: 'created' | 'skipped' | 'empty';
};

type UnmatchedRow = {
  externalId: string;
  qty: number;
  revenueKopecks: number;
  name: string | null;
};

type SalesImportResponse = {
  fileName: string;
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  headerRowNo: number;
  mapping: MappingRow[];
  skipped: Array<{ rowNo: number; reason: string }>;
  skippedCount: number;
  warnings: string[];
  channel: SalesChannel;
  fromPlaceCode: string;
  dryRun: boolean;
  docs: ImportDoc[];
  unmatched: UnmatchedRow[];
  totals: {
    parsedRows: number;
    docsCreated: number;
    docsSkipped: number;
    qtySold: number;
    qtyReturned: number;
    revenueKopecks: number;
    unmatchedRevenueKopecks: number;
    unmatchedCount: number;
  };
};

// ---------------------------------------------------------------------------
// Подписи
// ---------------------------------------------------------------------------

const FIELD_LABEL: Record<string, string> = {
  date: 'Дата',
  externalId: 'Артикул',
  externalSku: 'Код маркетплейса',
  qty: 'Количество',
  revenue: 'Выручка',
  docType: 'Тип операции',
  name: 'Название',
};

/** Порядок показа сопоставления: сначала то, без чего импорт невозможен. */
const FIELD_ORDER: readonly string[] = [
  'date',
  'externalId',
  'externalSku',
  'qty',
  'revenue',
  'docType',
  'name',
];

/** Сколько пропущенных строк файла показываем списком. */
const SKIPPED_PREVIEW = 10;

function docStatusLabel(status: ImportDoc['status'], dryRun: boolean): string {
  if (status === 'skipped') return 'уже импортирован';
  if (status === 'empty') return 'нет сшитых позиций';
  return dryRun ? 'будет создан' : 'создан';
}

function formatQty(qty: number): string {
  return qty.toLocaleString('ru-RU');
}

export function SalesImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState<SalesChannel>('wb');
  const [placeCode, setPlaceCode] = useState<string>(DEFAULT_PLACE_CODE);
  const [places, setPlaces] = useState<PlaceOption[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<string>('');
  const [preview, setPreview] = useState<SalesImportResponse | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = parsing || importing;

  // Открытие — чистый лист: чужой файл и чужое превью из прошлого раза здесь
  // опаснее, чем лишний клик.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setError(null);
    setFile(null);
    setSheet('');
    if (fileInputRef.current) fileInputRef.current.value = '';

    let cancelled = false;
    (async () => {
      const res = await stockFetch<BalancesResponse>('/api/stock/balances?limit=1');
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Списывать можно только с журнальных мест: у 'external' остаток приходит
      // из API маркетплейса, и наши движения его не меняют.
      const ledger = (res.data.places ?? []).filter(
        (p) => p.authority === 'ledger' && p.isActive !== false,
      );
      setPlaces(ledger);
      setPlaceCode((prev) => {
        if (ledger.some((p) => p.code === prev)) return prev;
        return (
          ledger.find((p) => p.code === DEFAULT_PLACE_CODE)?.code ??
          ledger[0]?.code ??
          DEFAULT_PLACE_CODE
        );
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = useCallback(
    async (dryRun: boolean, sheetName?: string) => {
      if (!file) {
        setError('Сначала выберите файл выгрузки продаж');
        return;
      }
      const form = new FormData();
      form.append('file', file);
      form.append('channel', channel);
      form.append('dryRun', dryRun ? '1' : '0');
      if (placeCode) form.append('fromPlace', placeCode);
      const wantedSheet = sheetName ?? sheet;
      if (wantedSheet) form.append('sheet', wantedSheet);

      setError(null);
      if (dryRun) setParsing(true);
      else setImporting(true);
      const res = await stockFetch<SalesImportResponse>('/api/stock/import/sales', {
        method: 'POST',
        body: form,
      });
      if (dryRun) setParsing(false);
      else setImporting(false);

      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.data);
      setSheet(res.data.sheetName);
      if (!dryRun) {
        onDone();
        onClose();
      }
    },
    [file, channel, placeCode, sheet, onDone, onClose],
  );

  const mappingByField = useMemo(() => {
    const byField = new Map<string, MappingRow>();
    for (const row of preview?.mapping ?? []) byField.set(row.field, row);
    return byField;
  }, [preview]);

  /** Поля в каноническом порядке + всё незнакомое хвостом (ничего не прячем). */
  const mappingRows = useMemo(() => {
    const rows: MappingRow[] = [];
    for (const field of FIELD_ORDER) {
      const row = mappingByField.get(field);
      if (row) rows.push(row);
    }
    for (const row of preview?.mapping ?? []) {
      if (!FIELD_ORDER.includes(row.field)) rows.push(row);
    }
    return rows;
  }, [mappingByField, preview]);

  const placeName =
    places.find((p) => p.code === (preview?.fromPlaceCode ?? placeCode))?.name ??
    preview?.fromPlaceCode ??
    placeCode;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Импорт продаж из файла
          </DialogTitle>
          <DialogDescription>
            Выгрузка продаж Wildberries или Яндекс.Маркета превращается в расходные
            документы склада. Сначала разбираем файл и показываем, что получится, —
            в журнал ничего не пишем до вашего подтверждения.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="min-w-0 break-words text-[12px]">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* --------------------------- ШАГ 1: разбор --------------------------- */}
          {!preview && (
            <div className="min-w-0 space-y-3">
              <div className="min-w-0 space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">Канал</div>
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {CHANNELS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={busy}
                      onClick={() => setChannel(c)}
                      className={cn(
                        'rounded px-3 py-1 text-[12px] transition-colors',
                        channel === c
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {CHANNEL_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Списывать со склада
                  </div>
                  <Select value={placeCode} onValueChange={setPlaceCode} disabled={busy}>
                    <SelectTrigger className="h-8 min-w-0 text-[12px]">
                      <SelectValue placeholder="Выберите место" />
                    </SelectTrigger>
                    <SelectContent>
                      {places.map((p) => (
                        <SelectItem key={p.id} value={p.code}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Файл выгрузки
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={busy}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setPreview(null);
                      setError(null);
                      setSheet('');
                    }}
                    className="block h-8 w-full min-w-0 cursor-pointer rounded border border-border bg-background text-[12px] file:mr-2 file:h-full file:cursor-pointer file:border-0 file:bg-muted file:px-2 file:text-[12px] file:text-foreground"
                  />
                </div>
              </div>

              <div className="min-w-0 space-y-1 rounded border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <p>
                  Продажи списываются с выбранного склада. Документы проводятся сразу —
                  если что-то пойдёт не так, их можно сторнировать в «Склад · Документы».
                </p>
                <p>
                  Импортировать один и тот же период повторно безопасно: день, который
                  уже импортирован, пропускается (ключ — канал и дата). Недельные и
                  месячные выгрузки спокойно перекрываются.
                </p>
                <p>
                  Возвраты гасят продажи того же дня. Остаток возвратов приходуется
                  обратно по текущей средней стоимости и помечается «оценочно».
                </p>
              </div>
            </div>
          )}

          {/* ----------------------- ШАГ 2: превью и импорт ---------------------- */}
          {preview && (
            <div className="min-w-0 space-y-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="min-w-0 break-all font-medium text-foreground">
                  {preview.fileName}
                </span>
                <span>· {CHANNEL_LABEL[preview.channel]}</span>
                <span>· списание с «{placeName}»</span>
                <span>· заголовки в строке {preview.headerRowNo}</span>
                <span>· разобрано строк: {formatQty(preview.totals.parsedRows)}</span>
              </div>

              {preview.sheetNames.length > 1 && (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] text-muted-foreground">Лист</span>
                  <Select
                    value={preview.sheetName}
                    disabled={busy}
                    onValueChange={(v) => {
                      setSheet(v);
                      void run(true, v);
                    }}
                  >
                    <SelectTrigger className="h-7 w-64 min-w-0 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.sheetNames.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Сопоставление колонок */}
              <div className="min-w-0 rounded border border-border/60 p-2.5">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Колонки файла
                </div>
                <div className="grid min-w-0 gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
                  {mappingRows.map((row) => (
                    <div key={row.field} className="flex min-w-0 items-baseline gap-1">
                      <span className="shrink-0 text-muted-foreground">
                        {FIELD_LABEL[row.field] ?? row.field}
                      </span>
                      <span className="shrink-0 text-muted-foreground">=</span>
                      <span className="min-w-0 truncate" title={row.header}>
                        «{row.header || `колонка ${row.column + 1}`}»
                      </span>
                    </div>
                  ))}
                  {!mappingByField.has('revenue') && (
                    <div className="min-w-0 text-amber-700 dark:text-amber-400">
                      Выручка: колонка не найдена, суммы не заполнятся
                    </div>
                  )}
                </div>
              </div>

              {/* Итоги */}
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Продано, шт" value={formatQty(preview.totals.qtySold)} />
                <Stat label="Возвраты, шт" value={formatQty(preview.totals.qtyReturned)} />
                <Stat
                  label="Выручка, ₽"
                  value={formatMoney(preview.totals.revenueKopecks, true)}
                />
                <Stat
                  label={preview.dryRun ? 'Документов к созданию' : 'Документов создано'}
                  value={formatQty(preview.totals.docsCreated)}
                />
                <Stat
                  label="Уже импортировано"
                  value={formatQty(preview.totals.docsSkipped)}
                  muted
                />
              </div>

              {/* Не сопоставлено — самая дорогая часть превью */}
              {preview.unmatched.length > 0 && (
                <div className="min-w-0 rounded border border-amber-500/50 bg-amber-500/5 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Не сопоставлено: {preview.totals.unmatchedCount} позиц. на{' '}
                    {formatMoney(preview.totals.unmatchedRevenueKopecks, true)} ₽
                  </div>
                  <p className="mb-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-400">
                    Эти продажи НЕ попадут ни в склад, ни в себестоимость — товар канала
                    не сшит с нашей номенклатурой. Сшейте позиции на экране сопоставления
                    ДО импорта: уже проведённый день повторный импорт пропустит, и их
                    придётся заводить руками.
                  </p>
                  <div className="max-h-[22vh] min-w-0 overflow-auto rounded border border-amber-500/30">
                    <table className="w-full text-[12px]">
                      {/* Непрозрачный фон + isolate (blocks.mdc §Sticky cells): на
                              bg-amber-500/10 строки просвечивали сквозь шапку при
                              скролле. Тот же дефект чинили в Релизе 1. */}
                      <thead className="sticky top-0 z-10 isolate bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-left font-medium">Артикул</th>
                          <th className="px-2 py-1 text-left font-medium">Название</th>
                          <th className="w-20 px-2 py-1 text-right font-medium">Штук</th>
                          <th className="w-28 px-2 py-1 text-right font-medium">Выручка</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-500/20">
                        {preview.unmatched.map((u) => (
                          <tr key={u.externalId}>
                            <td className="min-w-0 px-2 py-1 font-mono text-[11px]">
                              <div className="max-w-[220px] truncate" title={u.externalId}>
                                {u.externalId}
                              </div>
                            </td>
                            <td className="min-w-0 px-2 py-1">
                              <div className="line-clamp-1">{u.name ?? '—'}</div>
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatQty(u.qty)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatMoney(u.revenueKopecks, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Документы по дням */}
              <div className="min-w-0">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Документы по дням
                </div>
                <div className="max-h-[28vh] min-w-0 overflow-auto rounded border border-border/60">
                  {preview.docs.length === 0 ? (
                    <div className="p-4 text-center text-[12px] text-muted-foreground">
                      Ни одного документа: в файле нет строк, пригодных для проводки.
                    </div>
                  ) : (
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 z-10 isolate bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="w-24 px-2 py-1 text-left font-medium">Дата</th>
                          <th className="w-24 px-2 py-1 text-left font-medium">Тип</th>
                          <th className="w-16 px-2 py-1 text-right font-medium">Строк</th>
                          <th className="w-20 px-2 py-1 text-right font-medium">Штук</th>
                          <th className="w-28 px-2 py-1 text-right font-medium">Сумма</th>
                          <th className="px-2 py-1 text-left font-medium">Статус</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {preview.docs.map((d) => (
                          <tr
                            key={`${d.date}-${d.kind}`}
                            className={d.status === 'created' ? '' : 'opacity-60'}
                          >
                            <td className="px-2 py-1 tabular-nums">{d.date}</td>
                            <td className="px-2 py-1">
                              {d.kind === 'sale' ? 'Продажа' : 'Возврат'}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatQty(d.linesCount)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatQty(d.qtyTotal)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {formatMoney(d.revenueKopecks, true)}
                            </td>
                            <td
                              className={cn(
                                'px-2 py-1 text-[11px]',
                                d.status === 'created'
                                  ? 'text-muted-foreground'
                                  : 'text-muted-foreground/70',
                              )}
                            >
                              {docStatusLabel(d.status, preview.dryRun)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Пропущенные строки файла */}
              {preview.skippedCount > 0 && (
                <div className="min-w-0 rounded border border-border/60 p-2.5">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Пропущено строк файла: {formatQty(preview.skippedCount)}
                  </div>
                  <ul className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground">
                    {preview.skipped.slice(0, SKIPPED_PREVIEW).map((s) => (
                      <li key={s.rowNo} className="min-w-0 break-words">
                        Строка {s.rowNo} — {s.reason}
                      </li>
                    ))}
                    {preview.skippedCount > SKIPPED_PREVIEW && (
                      <li className="text-muted-foreground/70">
                        и ещё {formatQty(preview.skippedCount - SKIPPED_PREVIEW)}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertDescription className="min-w-0 space-y-0.5 text-[11px]">
                    {preview.warnings.map((w) => (
                      <div key={w} className="min-w-0 break-words">
                        {w}
                      </div>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                «Уже импортирован» — норма: день с этим каналом и датой уже лежит в
                журнале, повторно он не проводится. Документы проводятся сразу и
                сторнируются в «Склад · Документы». Возвраты гасят продажи того же дня, а
                их остаток приходуется по текущей средней и помечается «оценочно».
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {preview ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Назад
              </Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Закрыть
              </Button>
              <Button
                onClick={() => void run(false)}
                disabled={busy || preview.totals.docsCreated === 0}
                title={
                  preview.totals.docsCreated === 0
                    ? 'Импортировать нечего: все дни уже проведены или нет сшитых позиций'
                    : undefined
                }
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Импортировать ({preview.totals.docsCreated})
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Закрыть
              </Button>
              <Button onClick={() => void run(true)} disabled={busy || !file}>
                {parsing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                Разобрать
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0 rounded border border-border/60 px-2 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'truncate text-[14px] tabular-nums',
          muted ? 'text-muted-foreground' : 'font-medium',
        )}
      >
        {value}
      </div>
    </div>
  );
}
