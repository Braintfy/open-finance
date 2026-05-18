// PURPOSE: Секция «Импорт XLSX» в настройках блока unit.ozon-multi-table.
// Содержит:
//   - кнопку «Импорт цен из XLSX» (POST /api/unit-economics/import/ozon-prices),
//   - кнопку «Импорт товаров из XLSX» (тот же endpoint, расширенный),
//   - модалку с краткой инструкцией: где взять файл, какие столбцы важны,
//     что произойдёт после применения.
//
// Прежде эти кнопки жили в toolbar блока — пользователь жаловался на лишний
// шум сверху. Settings-таб — естественное место для редко используемого
// импорта.

'use client';

import { useRef, useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  ListChecks,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ImportKind = 'prices' | 'products';

type ImportResult = {
  ok: boolean;
  preview?: boolean;
  committed?: boolean;
  filename?: string;
  totalRows?: number;
  inserted?: number;
  recognizedColumns?: Record<string, string>;
  unrecognizedColumns?: string[];
  warnings?: string[];
  error?: string;
  sample?: Array<Record<string, unknown>>;
};

export type OzonImportSectionProps = {
  /** Колбэк после успешного commit — блок может перечитать данные/применить diff. */
  onImportCommitted?: () => void;
};

export function OzonImportSection({ onImportCommitted }: OzonImportSectionProps) {
  const pricesInputRef = useRef<HTMLInputElement | null>(null);
  const productsInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<ImportKind | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function uploadFile(kind: ImportKind, file: File, commit: boolean) {
    setBusy(kind);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('commit', commit ? 'true' : 'false');
      const res = await fetch('/api/unit-economics/import/ozon-prices', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as ImportResult;
      setResult(data);
      if (commit && data.ok) onImportCommitted?.();
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[12px] font-semibold">Импорт XLSX</span>
        </div>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3 w-3" />
          Инструкция
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {/* Импорт цен */}
        <div className="rounded-md border border-border/60 bg-background p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
            <Upload className="h-3 w-3" />
            Импорт цен
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Шаблон «Обновление цен» из ЛК Ozon → раздел «Цены и акции» → «Шаблон цен».
          </p>
          <input
            ref={pricesInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile('prices', f, true);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => pricesInputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy === 'prices' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            Загрузить .xlsx
          </Button>
        </div>

        {/* Импорт товаров (фактически тот же endpoint, но семантически отделён в UI). */}
        <div className="rounded-md border border-border/60 bg-background p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium">
            <ListChecks className="h-3 w-3" />
            Импорт товаров
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Полный шаблон Ozon с артикулами / себестоимостями / остатками. Подходит, если магазин ещё не подключён по API.
          </p>
          <input
            ref={productsInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile('products', f, true);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => productsInputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy === 'products' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            Загрузить .xlsx
          </Button>
        </div>
      </div>

      {result && (
        <ImportResultBanner result={result} onClose={() => setResult(null)} />
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Импорт XLSX — инструкция</DialogTitle>
            <DialogDescription>
              Как заполнить шаблон Ozon и что произойдёт после загрузки.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[12px] leading-relaxed">
            <p>
              1. Зайдите в личный кабинет Ozon → раздел <b>«Цены и акции»</b> →
              <b> «Загрузка цен через файл»</b> и нажмите <b>«Скачать шаблон»</b>.
            </p>
            <p>
              2. В шаблоне используются листы <code>Инструкция</code> и
              <code>Товары и цены</code>. Заполнять ничего не нужно: мы читаем
              текущие значения колонок <i>Артикул</i>, <i>Название товара</i>,
              <i> Текущая цена (со скидкой)</i>, <i>Себестоимость</i>,
              <i> Объём, л</i>, <i>Остатки FBO/FBS</i>, комиссии Ozon, НДС.
            </p>
            <p>
              3. Колонки «Новая цена» / «Новая себестоимость» <b>не</b>
              используются — мы не отправляем цены обратно в Ozon, только
              читаем актуальное состояние.
            </p>
            <p>
              4. После загрузки данные попадут в <code>unit_products</code>.
              Чтобы применить их к строкам блока, после импорта откройте
              синхронизацию (кнопка «Синхронизировать») или используйте
              автоматический diff-превью.
            </p>
            <p className="text-muted-foreground">
              Парсер устойчив к лишним столбцам и пустым ячейкам.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ImportResultBanner({
  result,
  onClose,
}: {
  result: ImportResult;
  onClose: () => void;
}) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">Импорт не удался</div>
          <div className="opacity-80">{result.error ?? 'Неизвестная ошибка'}</div>
        </div>
        <button onClick={onClose} className="opacity-60 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 p-2 text-[11px] text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="flex-1 space-y-0.5">
        <div className="font-medium">
          Импортировано: {result.inserted ?? '—'} из {result.totalRows ?? '—'}
        </div>
        {result.warnings && result.warnings.length > 0 && (
          <div className="opacity-80">
            {result.warnings.slice(0, 2).join(' · ')}
            {result.warnings.length > 2 ? ` · +${result.warnings.length - 2}` : ''}
          </div>
        )}
        <div className="opacity-70">
          Распознано колонок: {Object.keys(result.recognizedColumns ?? {}).length}
        </div>
      </div>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
