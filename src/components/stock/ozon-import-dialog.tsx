// PURPOSE: Диалог «Импорт номенклатуры из Ozon» — шаг 1 переноса с бумаги
// (docs/STOCK_MODULE_DESIGN.md §8). Показывает, что именно будет создано, и
// требует явного подтверждения: автосоздание stock_items из канала запрещено
// (§10 риск 6 — ошибка в qty_per_unit портит остатки и COGS КРАТНО).
//
// min-w-0 на корневых контейнерах внутри DialogContent обязателен (blocks.mdc):
// у него display:grid, и длинный артикул иначе распирает модалку.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, PackagePlus } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { stockFetch } from './stock-api';

type Candidate = {
  unitProductId: string;
  article: string | null;
  sku: string | null;
  name: string;
  barcode: string | null;
  linkedItemId: string | null;
  existingItemId: string | null;
  suggestedQtyPerUnit: number;
};

type PreviewResponse = {
  candidates: Candidate[];
  totals: { total: number; willCreate: number; willLinkOnly: number; alreadyLinked: number };
};

export function OzonImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtyPerUnit, setQtyPerUnit] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await stockFetch<PreviewResponse>('/api/stock/import?mode=ozon');
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setData(res.data);
    // По умолчанию выбираем всё, что ещё не сшито: это и есть «одна кнопка».
    const fresh = res.data.candidates.filter((c) => !c.linkedItemId);
    setSelected(new Set(fresh.map((c) => c.unitProductId)));
    setQtyPerUnit(
      Object.fromEntries(fresh.map((c) => [c.unitProductId, c.suggestedQtyPerUnit])),
    );
  }, []);

  useEffect(() => {
    if (open) {
      setResult(null);
      load();
    }
  }, [open, load]);

  const visible = useMemo(() => {
    const rows = data?.candidates ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.article ?? '').toLowerCase().includes(q) ||
        (c.sku ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function run() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    const res = await stockFetch<{
      itemsCreated: number;
      linksCreated: number;
      skipped: number;
      problems: Array<{ name: string; reason: string }>;
    }>('/api/stock/import', {
      method: 'POST',
      body: JSON.stringify({
        unitProductIds: Array.from(selected),
        qtyPerUnit: Object.fromEntries(
          Array.from(selected).map((id) => [id, qtyPerUnit[id] ?? 1]),
        ),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(
      `Создано товаров: ${res.data.itemsCreated}, сшивок: ${res.data.linksCreated}` +
        (res.data.skipped > 0 ? `, пропущено (уже были): ${res.data.skipped}` : '') +
        (res.data.problems.length > 0
          ? `. Без артикула и sku: ${res.data.problems.length} — их надо завести вручную.`
          : ''),
    );
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" /> Номенклатура из Ozon
          </DialogTitle>
          <DialogDescription>
            Заводим наши товары из карточек Ozon и сразу сшиваем их с каналом.
            Артикул продавца становится внутренним артикулом склада.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {result && (
            <Alert>
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          )}

          {data && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Всего карточек: {data.totals.total}</span>
              <span>· Будет создано: {data.totals.willCreate}</span>
              <span>· Только сшивка: {data.totals.willLinkOnly}</span>
              <span>· Уже сшито: {data.totals.alreadyLinked}</span>
            </div>
          )}

          <Input
            placeholder="Поиск по названию или артикулу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-[45vh] min-w-0 overflow-auto rounded border border-border/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загружаем каталог Ozon…
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                Карточек Ozon не найдено. Сначала синхронизируйте магазин в разделе
                «Аналитика».
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-10 bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">Товар</th>
                    <th className="px-2 py-1.5 text-left font-medium">Артикул</th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium" title="Сколько базовых единиц в карточке: «3 банки» = 3">
                      Ед. в карт.
                    </th>
                    <th className="w-28 px-2 py-1.5 text-left font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {visible.map((c) => {
                    const linked = Boolean(c.linkedItemId);
                    return (
                      <tr key={c.unitProductId} className={linked ? 'opacity-50' : ''}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            disabled={linked}
                            checked={selected.has(c.unitProductId)}
                            onChange={() => toggle(c.unitProductId)}
                          />
                        </td>
                        <td className="min-w-0 px-2 py-1.5">
                          <div className="line-clamp-1">{c.name || '—'}</div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                          {c.article ?? c.sku ?? '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            disabled={linked || !selected.has(c.unitProductId)}
                            value={qtyPerUnit[c.unitProductId] ?? 1}
                            onChange={(e) =>
                              setQtyPerUnit((prev) => ({
                                ...prev,
                                [c.unitProductId]: Math.max(1, Number(e.target.value) || 1),
                              }))
                            }
                            className="h-6 w-16 rounded border border-border bg-background px-1 text-right text-[12px] tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          {linked
                            ? 'уже сшито'
                            : c.existingItemId
                              ? 'только сшивка'
                              : 'создать товар'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Колонка «Ед. в карт.» — сколько базовых единиц продаётся в одной карточке
            канала. Для набора «3 банки» поставьте 3, иначе остатки и себестоимость
            уедут ровно втрое.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={run} disabled={saving || selected.size === 0}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackagePlus className="h-3.5 w-3.5" />
            )}
            Импортировать ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
