// PURPOSE: Ввод документов, у которых есть ВТОРАЯ СТОРОНА (docs/STOCK_MODULE_DESIGN.md
// §4.5, §4.6, §5) — отгрузка (`transfer`), приёмка на складе маркетплейса
// (`accept`), пересортица (`regrade`) и инвентаризация (`adjust`).
// Поступление, возврат и списание вводит соседний stock-doc-dialog.tsx.
//
// ЧТО ЗДЕСЬ ВАЖНО ОБЪЯСНИТЬ ЧЕЛОВЕКУ (иначе он решит, что система теряет товар):
//   • отгрузка НЕ уменьшает капитализацию: товар переезжает «в пути», деньги
//     переезжают вместе с ним (Σ по документу = 0);
//   • отгрузка на склад Ozon (место маркетплейса) — наоборот, выводит стоимость
//     из журнала: остатки складов Ozon мы не ведём, их отдаёт API (§1.2);
//   • в приёмке вводится ДВА числа: сколько отгрузили и сколько маркетплейс
//     принял. Разница — не «усушка», а отдельная статья потерь mp_shortage,
//     и через год по ней видно суммой, сколько товара съел маркетплейс;
//   • пересортица переносит стоимость с одного товара на другой ЦЕЛИКОМ,
//     поэтому количества сторон обязаны совпадать.
//
// Количество строк документа считает сервер (planDocLegs): здесь строится
// только payload. Для пересортицы порядок строк ВАЖЕН — сначала все расходные,
// потом приходные с pairLineNo = номер своей расходной (нумерация строк на
// сервере идёт по порядку массива, начиная с 1).
//
// Дата документа — календарный день Москвы (moscowDateString): по МСК работает
// и фильтр ленты документов.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { moscowDateString } from '@/lib/marketplaces/ozon/sync/perf-period';
import { parseQty, stockFetch } from './stock-api';

type Item = { id: string; sku: string; name: string };

type Place = {
  id: string;
  code: string;
  name: string;
  kind: string;
  authority: 'ledger' | 'external';
  isActive: boolean;
};

type LineDraft = {
  key: string;
  itemId: string;
  qty: string;
  /** accept — «принято фактически»; пусто = принято всё. */
  acceptedQty: string;
  /** regrade — товар, которым оказалась позиция. */
  toItemId: string;
  /** adjust — фактически посчитанный остаток; пусто = расхождения нет. */
  factQty: string;
};

export type StockMoveKind = 'transfer' | 'accept' | 'regrade' | 'adjust';

const KIND_LABEL: Record<StockMoveKind, string> = {
  transfer: 'Отгрузка / перемещение',
  accept: 'Приёмка на складе маркетплейса',
  regrade: 'Пересортица',
  adjust: 'Инвентаризация',
};

const KIND_HINT: Record<StockMoveKind, string> = {
  transfer:
    'Товар меняет место, а не стоимость: сколько списалось с одного места, столько и приходуется на другое. Если приёмник — склад маркетплейса, стоимость выходит из журнала: остатки там ведёт сам маркетплейс.',
  accept:
    'Введите, сколько отгружали и сколько маркетплейс принял фактически. Разница уйдёт отдельной статьёй потерь — она не растворится в себестоимости.',
  regrade:
    'Пересорт переносит стоимость с одного товара на другой целиком, поэтому количества сторон должны совпадать. Прибыль от этого не меняется.',
  adjust:
    'Введите фактический остаток только там, где он разошёлся с расчётным. Излишек приходуется по текущей средней, недостача по ней же списывается — средняя от этого не искажается.',
};

/** Значения мест по умолчанию для каждого вида. */
const DEFAULT_FROM: Record<StockMoveKind, string> = {
  transfer: 'own',
  accept: 'transit_ozon',
  regrade: 'own',
  adjust: 'own',
};
const DEFAULT_TO: Record<StockMoveKind, string> = {
  transfer: 'transit_ozon',
  accept: 'ozon_fbo',
  regrade: 'own',
  adjust: 'own',
};

/** Виды, у которых источник и приёмник — одно и то же место. */
const SINGLE_PLACE_KINDS: readonly StockMoveKind[] = ['regrade', 'adjust'];

function todayIso(): string {
  return moscowDateString(new Date());
}

function newLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    itemId: '',
    qty: '1',
    acceptedQty: '',
    toItemId: '',
    factQty: '',
  };
}

export function StockMoveDialog({
  open,
  kind,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: StockMoveKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  /** itemId → расчётный остаток по местам (нужен только инвентаризации). */
  const [ledgerQty, setLedgerQty] = useState<Map<string, Record<string, number>>>(
    () => new Map(),
  );
  const [docDate, setDocDate] = useState(todayIso());
  const [fromCode, setFromCode] = useState(DEFAULT_FROM[kind]);
  const [toCode, setToCode] = useState(DEFAULT_TO[kind]);
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [itemsRes, settingsRes] = await Promise.all([
      stockFetch<{ items: Item[] }>('/api/stock/items?limit=1000'),
      stockFetch<{ places: Place[] }>('/api/stock/settings'),
    ]);
    if (itemsRes.ok) setItems(itemsRes.data.items);
    if (settingsRes.ok) setPlaces(settingsRes.data.places.filter((p) => p.isActive));

    // Расчётный остаток нужен ТОЛЬКО инвентаризации: в остальных видах он не
    // участвует, а запрос остатков тяжёлый (UNION журнала и складов Ozon).
    if (kind !== 'adjust') return;
    const balances = await stockFetch<{
      rows: Array<{ itemId: string; byPlace: Record<string, number> }>;
    }>('/api/stock/balances?limit=1000');
    if (balances.ok) {
      setLedgerQty(new Map(balances.data.rows.map((r) => [r.itemId, r.byPlace ?? {}])));
    }
  }, [kind]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDocDate(todayIso());
    setFromCode(DEFAULT_FROM[kind]);
    setToCode(DEFAULT_TO[kind]);
    setComment('');
    setLines([newLine()]);
    load();
  }, [open, kind, load]);

  /** Источник — только журнальные места: по складам маркетплейса движений нет. */
  const fromPlaces = useMemo(() => places.filter((p) => p.authority === 'ledger'), [places]);
  /** Приёмник — любое место, включая внешние (отгрузка на Ozon FBO). */
  const toPlaces = places;

  const toPlace = places.find((p) => p.code === toCode) ?? null;
  const isExternalTarget = toPlace?.authority === 'external';
  const fromPlaceId = places.find((p) => p.code === fromCode)?.id ?? '';

  /** Расчётный остаток строки в выбранном месте (инвентаризация). */
  const calcQtyOf = useCallback(
    (itemId: string): number => (ledgerQty.get(itemId) ?? {})[fromPlaceId] ?? 0,
    [ledgerQty, fromPlaceId],
  );
  /** Знаковое расхождение «факт − расчёт». */
  const deltaOf = useCallback(
    (line: LineDraft): number => {
      if (line.factQty.trim() === '' || !line.itemId) return 0;
      const fact = Math.max(0, Math.trunc(Number(line.factQty.replace(/\s/g, '')) || 0));
      return fact - calcQtyOf(line.itemId);
    },
    [calcQtyOf],
  );

  const patchLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const validLines = useMemo(
    () =>
      lines.filter((l) => {
        if (!l.itemId) return false;
        // Инвентаризация: строка нужна только там, где факт РАЗОШЁЛСЯ с расчётом
        // (§4.6) — пустое поле «факт» означает «сходится», такую строку не проводим.
        if (kind === 'adjust') return l.factQty.trim() !== '';
        if (parseQty(l.qty) <= 0) return false;
        if (kind === 'regrade' && (!l.toItemId || l.toItemId === l.itemId)) return false;
        return true;
      }),
    [lines, kind],
  );

  /** Сколько штук маркетплейс не принял — цифра, ради которой всё затевалось. */
  const shortageQty = useMemo(() => {
    if (kind !== 'accept') return 0;
    return validLines.reduce((sum, l) => {
      const qty = parseQty(l.qty);
      const accepted = l.acceptedQty.trim() === '' ? qty : parseQty(l.acceptedQty);
      return sum + Math.max(0, qty - accepted);
    }, 0);
  }, [kind, validLines]);

  const acceptOverflow = useMemo(() => {
    if (kind !== 'accept') return false;
    return validLines.some(
      (l) => l.acceptedQty.trim() !== '' && parseQty(l.acceptedQty) > parseQty(l.qty),
    );
  }, [kind, validLines]);

  /** Строки инвентаризации, где факт реально разошёлся с расчётом. */
  const adjustLines = useMemo(
    () => (kind === 'adjust' ? validLines.filter((l) => deltaOf(l) !== 0) : []),
    [kind, validLines, deltaOf],
  );

  const canSave =
    !acceptOverflow &&
    (kind === 'adjust' ? adjustLines.length > 0 : validLines.length > 0) &&
    (SINGLE_PLACE_KINDS.includes(kind) || fromCode !== toCode);

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Пересортица: сначала ВСЕ расходные строки, потом приходные с ссылкой на
    // свою расходную по номеру. Сервер нумерует строки по порядку массива.
    const payloadLines =
      kind === 'adjust'
        ? // §4.6: излишек приходуется, недостача списывается — обе стороны по
          // текущей средней. counted_qty сохраняется как введённый факт.
          adjustLines.map((l) => {
            const delta = deltaOf(l);
            return {
              itemId: l.itemId,
              direction: (delta > 0 ? 'in' : 'out') as 'in' | 'out',
              qty: Math.abs(delta),
              countedQty: calcQtyOf(l.itemId) + delta,
            };
          })
        : kind === 'regrade'
        ? [
            ...validLines.map((l) => ({
              itemId: l.itemId,
              direction: 'out' as const,
              qty: parseQty(l.qty),
            })),
            ...validLines.map((l, i) => ({
              itemId: l.toItemId,
              direction: 'in' as const,
              qty: parseQty(l.qty),
              pairLineNo: i + 1,
            })),
          ]
        : validLines.map((l) => ({
            itemId: l.itemId,
            direction: 'out' as const,
            qty: parseQty(l.qty),
            countedQty:
              kind === 'accept' && l.acceptedQty.trim() !== ''
                ? parseQty(l.acceptedQty)
                : null,
          }));

    const res = await stockFetch<{ docId: string }>('/api/stock/docs', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        docDate,
        fromPlaceCode: fromCode,
        // У пересортицы и инвентаризации приёмник совпадает с источником.
        toPlaceCode: SINGLE_PLACE_KINDS.includes(kind) ? fromCode : toCode,
        reason: kind === 'adjust' ? 'recount' : null,
        comment: comment.trim() || null,
        lines: payloadLines,
        post: true,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" /> {KIND_LABEL[kind]}
          </DialogTitle>
          <DialogDescription>{KIND_HINT[kind]}</DialogDescription>
        </DialogHeader>

        {/* min-w-0: DialogContent — grid, и без него длинное название товара
            распирает модалку вместо усечения (blocks.mdc). */}
        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
            <label className="min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">Дата операции</span>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </label>
            <label className="min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">
                {SINGLE_PLACE_KINDS.includes(kind) ? 'Место' : 'Откуда'}
              </span>
              <Select value={fromCode} onValueChange={setFromCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fromPlaces.map((p) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {!SINGLE_PLACE_KINDS.includes(kind) && (
              <label className="min-w-0 space-y-1">
                <span className="text-[11px] text-muted-foreground">Куда</span>
                <Select value={toCode} onValueChange={setToCode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {toPlaces.map((p) => (
                      <SelectItem key={p.code} value={p.code}>
                        {p.name}
                        {p.authority === 'external' ? ' · остаток ведёт маркетплейс' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">Комментарий</span>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="номер поставки, машина…"
              />
            </label>
          </div>

          {!SINGLE_PLACE_KINDS.includes(kind) && fromCode === toCode && (
            <Alert>
              <AlertDescription>
                Источник и приёмник совпадают — выберите разные места.
              </AlertDescription>
            </Alert>
          )}

          <div className="min-w-0 overflow-x-auto rounded border border-border/60">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">
                    {kind === 'regrade' ? 'Было (списывается)' : 'Товар'}
                  </th>
                  {kind === 'regrade' && (
                    <th className="px-2 py-1.5 text-left font-medium">
                      Оказалось (приходуется)
                    </th>
                  )}
                  {kind === 'adjust' ? (
                    <>
                      <th className="w-24 px-2 py-1.5 text-right font-medium">Расчёт</th>
                      <th className="w-24 px-2 py-1.5 text-right font-medium">Факт</th>
                      <th className="w-20 px-2 py-1.5 text-right font-medium">Δ</th>
                    </>
                  ) : (
                    <th className="w-24 px-2 py-1.5 text-right font-medium">
                      {kind === 'accept' ? 'Отгружено' : 'Кол-во'}
                    </th>
                  )}
                  {kind === 'accept' && (
                    <th className="w-28 px-2 py-1.5 text-right font-medium">Принято</th>
                  )}
                  <th className="w-8 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {lines.map((line) => {
                  const qty = parseQty(line.qty);
                  const accepted =
                    line.acceptedQty.trim() === '' ? qty : parseQty(line.acceptedQty);
                  const lineShortage = kind === 'accept' ? Math.max(0, qty - accepted) : 0;
                  return (
                    <tr key={line.key}>
                      <td className="min-w-0 px-2 py-1">
                        <Select
                          value={line.itemId || undefined}
                          onValueChange={(v) => patchLine(line.key, { itemId: v })}
                        >
                          <SelectTrigger className="h-7 min-w-0 text-[12px]">
                            <SelectValue placeholder="Выберите товар" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name || i.sku}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {kind === 'regrade' && (
                        <td className="min-w-0 px-2 py-1">
                          <Select
                            value={line.toItemId || undefined}
                            onValueChange={(v) => patchLine(line.key, { toItemId: v })}
                          >
                            <SelectTrigger className="h-7 min-w-0 text-[12px]">
                              <SelectValue placeholder="Чем оказался" />
                            </SelectTrigger>
                            <SelectContent>
                              {items
                                .filter((i) => i.id !== line.itemId)
                                .map((i) => (
                                  <SelectItem key={i.id} value={i.id}>
                                    {i.name || i.sku}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      {kind === 'adjust' ? (
                        <>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {line.itemId ? calcQtyOf(line.itemId) : '—'}
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              className="h-7 text-right text-[12px]"
                              inputMode="numeric"
                              placeholder="сходится"
                              value={line.factQty}
                              onChange={(e) =>
                                patchLine(line.key, { factQty: e.target.value })
                              }
                            />
                          </td>
                          <td
                            className={
                              'px-2 py-1 text-right tabular-nums ' +
                              (deltaOf(line) > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : deltaOf(line) < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-muted-foreground')
                            }
                          >
                            {line.factQty.trim() === ''
                              ? '—'
                              : deltaOf(line) > 0
                                ? `+${deltaOf(line)}`
                                : deltaOf(line)}
                          </td>
                        </>
                      ) : (
                        <td className="px-2 py-1">
                          <Input
                            className="h-7 text-right text-[12px]"
                            inputMode="numeric"
                            value={line.qty}
                            onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                          />
                        </td>
                      )}
                      {kind === 'accept' && (
                        <td className="px-2 py-1">
                          <Input
                            className="h-7 text-right text-[12px]"
                            inputMode="numeric"
                            placeholder="всё"
                            value={line.acceptedQty}
                            onChange={(e) =>
                              patchLine(line.key, { acceptedQty: e.target.value })
                            }
                          />
                          {lineShortage > 0 && (
                            <div className="pt-0.5 text-right text-[10px] text-amber-600 dark:text-amber-400">
                              недостача {lineShortage}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          className="text-muted-foreground transition hover:text-destructive"
                          title="Удалить строку"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length === 1
                                ? [newLine()]
                                : prev.filter((l) => l.key !== line.key),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus className="h-3.5 w-3.5" /> Строка
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {kind === 'adjust'
                ? `Расхождений: ${adjustLines.length}`
                : `Позиций: ${validLines.length}`}
            </span>
            {kind === 'adjust' && (
              <span className="text-[11px] text-muted-foreground">
                Строки, где факт совпал с расчётом, в документ не попадут
              </span>
            )}
            {kind === 'accept' && shortageQty > 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Недостача {shortageQty} шт уйдёт в потери маркетплейса — отдельной статьёй,
                не в себестоимость
              </span>
            )}
            {kind === 'transfer' && isExternalTarget && (
              <span className="text-[11px] text-muted-foreground">
                Приёмник ведёт маркетплейс: стоимость выйдет из журнала, остаток покажет его API
              </span>
            )}
            {acceptOverflow && (
              <span className="text-[11px] text-destructive">
                Принято больше, чем отгружено — так приёмку не оформляют
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Провести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
