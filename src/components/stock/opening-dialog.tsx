// PURPOSE: Диалог стартовых остатков (документ `opening`) — шаг 4 переноса с
// бумаги (docs/STOCK_MODULE_DESIGN.md §8). Таблица по всей номенклатуре:
// количество на СВОЁМ складе + цена. Количества Ozon показаны справочно —
// журнал их не ведёт (§3), это остаток маркетплейса, а не наш.
//
// Три правила из §8 шага 4, зашитые в UI:
//   • строки с qty = 0 не отправляются (их просто нет на складе);
//   • цену «не помню» отмечают галочкой «оценочно» (is_estimated), а не
//     выдуманным числом — иначе неверная цифра станет неотличима от точной;
//   • товар без цены получает бейдж «нет себестоимости» — это рабочий to-do.
//
// Итог считается ТЕМ ЖЕ rublesToKopecks, что и payload (см. money.ts): здесь
// цена ошибки максимальная — стартовые остатки становятся базой всей
// последующей себестоимости, и «1 200» из накладной обязан дать 1200 ₽ и в
// превью, и в документе. Дата отсечки — календарный день Москвы.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Loader2, Save } from 'lucide-react';
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
import { moscowDateString } from '@/lib/marketplaces/ozon/sync/perf-period';
import {
  formatMoney,
  kopecksToRublesInput,
  linesTotalKopecks,
  parseQty,
  rublesToKopecks,
  stockFetch,
} from './stock-api';

type TemplateRow = {
  itemId: string;
  sku: string;
  name: string;
  brand: string | null;
  ledgerQty: number;
  ozonQty: number;
  suggestedUnitPriceKopecks: number;
  priceUnknown: boolean;
};

type Draft = { qty: string; priceRub: string; isEstimated: boolean };

/** Сегодня по календарю Москвы — той же зоне, в которой фильтруется лента. */
function todayIso(): string {
  return moscowDateString(new Date());
}

export function OpeningDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [docDate, setDocDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await stockFetch<{ rows: TemplateRow[] }>('/api/stock/import?mode=opening');
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(res.data.rows);
    setDraft(
      Object.fromEntries(
        res.data.rows.map((r) => [
          r.itemId,
          {
            qty: '',
            priceRub: kopecksToRublesInput(r.suggestedUnitPriceKopecks),
            isEstimated: r.priceUnknown,
          },
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    if (open) {
      setDocDate(todayIso());
      load();
    }
  }, [open, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const filled = useMemo(
    () => Object.values(draft).filter((d) => parseQty(d.qty) > 0).length,
    [draft],
  );

  // Превью = payload: тот же парсер, те же копейки.
  const totalKopecks = useMemo(
    () => linesTotalKopecks(Object.values(draft)),
    [draft],
  );

  async function save() {
    const lines = Object.entries(draft)
      .filter(([, d]) => parseQty(d.qty) > 0)
      .map(([itemId, d]) => ({
        itemId,
        direction: 'in' as const,
        qty: parseQty(d.qty),
        unitPriceKopecks: rublesToKopecks(d.priceRub),
        isEstimated: d.isEstimated || rublesToKopecks(d.priceRub) <= 0,
      }));
    if (lines.length === 0) return;

    setSaving(true);
    setError(null);
    const res = await stockFetch<{ docId: string }>('/api/stock/docs', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'opening',
        docDate,
        supplier: '',
        comment: 'Стартовые остатки (перенос с бумаги)',
        lines,
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Стартовые остатки
          </DialogTitle>
          <DialogDescription>
            Дата отсечки, с которой начинается журнал. Заполните только те товары,
            что реально лежат на своём складе — остальные строки не сохранятся.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Дата отсечки</span>
              <Input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                className="w-40"
              />
            </label>
            <Input
              placeholder="Поиск товара"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <span className="pb-2 text-[11px] text-muted-foreground">
              Заполнено строк: {filled}
            </span>
          </div>

          <div className="max-h-[48vh] min-w-0 overflow-auto rounded border border-border/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Готовим список…
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                Номенклатуры нет. Сначала импортируйте товары из Ozon.
              </div>
            ) : (
              <table className="w-full text-[12px]">
                {/* Sticky-заголовок непрозрачен (bg-muted, не /60) и isolate —
                    иначе строки просвечивают сквозь него при скролле. */}
                <thead className="sticky top-0 z-10 isolate bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Товар</th>
                    <th className="w-20 px-2 py-1.5 text-right font-medium" title="Справочно: остаток на складах Ozon — журнал его не ведёт">
                      На Ozon
                    </th>
                    <th className="w-24 px-2 py-1.5 text-right font-medium">Свой склад</th>
                    <th className="w-28 px-2 py-1.5 text-right font-medium">Цена, ₽</th>
                    <th className="w-20 px-2 py-1.5 text-center font-medium">Оценочно</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {visible.map((r) => {
                    const d = draft[r.itemId] ?? { qty: '', priceRub: '', isEstimated: false };
                    return (
                      <tr key={r.itemId}>
                        <td className="min-w-0 px-2 py-1">
                          <div className="line-clamp-1">{r.name || r.sku}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {r.sku}
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {r.ozonQty.toLocaleString('ru-RU')}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            value={d.qty}
                            placeholder="0"
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [r.itemId]: { ...d, qty: e.target.value },
                              }))
                            }
                            className="h-7 w-full rounded border border-border bg-background px-1 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            inputMode="decimal"
                            value={d.priceRub}
                            placeholder="0"
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [r.itemId]: { ...d, priceRub: e.target.value },
                              }))
                            }
                            className="h-7 w-full rounded border border-border bg-background px-1 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={d.isEstimated}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [r.itemId]: { ...d, isEstimated: e.target.checked },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Цену не помните — оставьте подсказку и поставьте «оценочно»: такие партии
              будут помечены во всех отчётах, пока вы их не уточните.
            </span>
            <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
              {formatMoney(totalKopecks, true)} ₽
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={saving || filled === 0}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Провести остатки ({filled})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
