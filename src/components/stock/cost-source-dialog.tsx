// PURPOSE: Диалог «Перевести себестоимость на склад» — шаг 5 переноса с бумаги
// и обязательная часть Релиза 1 (docs/STOCK_MODULE_DESIGN.md §6.1).
// Таблица «товар / было ₽ / станет ₽ / Δ%» с чекбоксами.
//
// ЗАЧЕМ ОН ВООБЩЕ НУЖЕН: колонка unit_products.cost_source по умолчанию 'manual',
// поэтому writeback склада сам по себе не меняет НИ ОДНОЙ цифры. Без этого экрана
// вся работа по журналу останется невидимой — аналитика продолжит показывать
// старые ручные цены. Это та самая точка, после которой маржа становится реальной.
//
// Обратный переход ('inventory' → 'manual') оставлен намеренно: если склад
// сказал ерунду, пользователь обязан иметь возможность вернуться, а не искать
// разработчика.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Scale } from 'lucide-react';
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
import { formatMoney, stockFetch } from './stock-api';

type PreviewRow = {
  unitProductId: string;
  article: string | null;
  productName: string;
  itemSku: string;
  qtyPerUnit: number;
  costSource: 'manual' | 'inventory';
  currentCostKopecks: number;
  nextCostKopecks: number;
  deltaPct: number | null;
  noCost: boolean;
  costBasisMixed: boolean;
};

export function CostSourceDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await stockFetch<{ rows: PreviewRow[] }>('/api/stock/writeback');
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(res.data.rows);
    // Позиции без себестоимости не предлагаем: писать 0 в карточку нельзя —
    // это выглядит как настоящая цена и даёт 100 % маржи в аналитике.
    setSelected(
      new Set(
        res.data.rows
          .filter((r) => !r.noCost && r.costSource !== 'inventory')
          .map((r) => r.unitProductId),
      ),
    );
  }, []);

  useEffect(() => {
    if (open) {
      setNotice(null);
      load();
    }
  }, [open, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        (r.article ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  async function apply(source: 'manual' | 'inventory') {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    const res = await stockFetch<{
      switched: number;
      writeback: { updated: number; skippedNoCost: number };
    }>('/api/stock/writeback', {
      method: 'POST',
      body: JSON.stringify({ unitProductIds: Array.from(selected), source }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(
      source === 'inventory'
        ? `Переведено на склад: ${res.data.switched}, себестоимость обновлена у ${res.data.writeback.updated}` +
            (res.data.writeback.skippedNoCost > 0
              ? `. Без себестоимости пропущено: ${res.data.writeback.skippedNoCost}`
              : '')
        : `Возвращено на ручную цену: ${res.data.switched}`,
    );
    onDone();
    load();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Себестоимость из склада
          </DialogTitle>
          <DialogDescription>
            После переключения аналитика Ozon, ABC и калькуляторы начнут считать маржу
            по реальной себестоимости журнала вместо ручной цифры. Количества товара
            остаются за синком — их модуль не трогает.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <Input
            placeholder="Поиск по названию или артикулу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-[45vh] min-w-0 overflow-auto rounded border border-border/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Считаем дельту…
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                Нет сшитых карточек. Сначала импортируйте номенклатуру и сопоставьте канал.
              </div>
            ) : (
              <table className="w-full text-[12px]">
                {/* Sticky-заголовок непрозрачен (bg-muted, не /60) и isolate —
                    иначе строки просвечивают сквозь него при скролле. */}
                <thead className="sticky top-0 z-10 isolate bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    <th className="px-2 py-1.5 text-left font-medium">Карточка</th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium">Было</th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium">Станет</th>
                    <th className="w-20 px-2 py-1.5 text-right font-medium">Δ%</th>
                    <th className="w-24 px-2 py-1.5 text-left font-medium">Источник</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {visible.map((r) => (
                    <tr key={r.unitProductId} className={r.noCost ? 'opacity-60' : ''}>
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-primary"
                          checked={selected.has(r.unitProductId)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.unitProductId)) next.delete(r.unitProductId);
                              else next.add(r.unitProductId);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="min-w-0 px-2 py-1.5">
                        <div className="line-clamp-1">{r.productName || r.article}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {r.itemSku}
                          {r.qtyPerUnit > 1 && ` · ${r.qtyPerUnit} ед. в карточке`}
                          {r.costBasisMixed && ' · смешанный базис НДС'}
                        </div>
                      </td>
                      {/* Себестоимость единицы печатается С КОПЕЙКАМИ всегда:
                          округление до рубля скрывает и саму дельту («было
                          119,90 → станет 120,40» выглядело бы как «120 → 120»),
                          и цену ошибки при умножении на тысячи штук. */}
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatMoney(r.currentCostKopecks, true)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.noCost ? '—' : formatMoney(r.nextCostKopecks, true)}
                      </td>
                      <td
                        className={
                          'px-2 py-1.5 text-right tabular-nums ' +
                          (r.deltaPct == null
                            ? 'text-muted-foreground'
                            : r.deltaPct > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : r.deltaPct < 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : '')
                        }
                      >
                        {r.deltaPct == null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`}
                      </td>
                      <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        {r.noCost
                          ? 'нет себестоимости'
                          : r.costSource === 'inventory'
                            ? 'склад'
                            : 'вручную'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button
            variant="outline"
            onClick={() => apply('manual')}
            disabled={saving || selected.size === 0}
          >
            Вернуть ручную
          </Button>
          <Button onClick={() => apply('inventory')} disabled={saving || selected.size === 0}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Перевести на склад ({selected.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
