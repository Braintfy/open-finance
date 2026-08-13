// PURPOSE: Ввод документа склада — сценарий «Новая поставка за 30-60 секунд»
// (docs/STOCK_MODULE_DESIGN.md §5). Дата предзаполнена, поставщик — свободный
// текст с автокомплитом, строки добавляются Enter'ом.
//
// Деньги вводятся в РУБЛЯХ и уходят на сервер в КОПЕЙКАХ (×100) — конвертация
// одна, в rublesToKopecks, чтобы «19,90» не превратилось в 1989 копеек через float.
// Это относится и к превью «Итого»: оно считается ТЕМ ЖЕ парсером и в тех же
// копейках, что и payload. Отдельное выражение в превью означало бы, что «1 200»
// (обычная вставка из накладной) показывает 0 ₽, а документ проводится на 1200 ₽.
// Доп. расходы (доставка/пошлина) разносятся по строкам на сервере методом
// наибольших остатков — здесь только сумма и способ.
//
// Дата документа — календарный день Москвы (moscowDateString), потому что по
// MSC работает и фильтр ленты документов. Локальный getFullYear() дал бы
// пользователю в другой зоне документ, не попадающий в свой же период.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
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
import {
  formatMoney,
  linesTotalKopecks,
  parseQty,
  rublesToKopecks,
  stockFetch,
} from './stock-api';

type Item = { id: string; sku: string; name: string };

type LineDraft = {
  key: string;
  itemId: string;
  qty: string;
  priceRub: string;
  isEstimated: boolean;
  expiresAt: string;
};

export type StockDocKindUi = 'purchase' | 'writeoff' | 'return_in';

const KIND_LABEL: Record<StockDocKindUi, string> = {
  purchase: 'Поступление',
  return_in: 'Возврат на склад',
  writeoff: 'Списание',
};

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'expired', label: 'Просрочка' },
  { value: 'damaged', label: 'Брак / повреждение' },
  { value: 'lost', label: 'Потеря' },
  { value: 'sample', label: 'Образец' },
  { value: 'mp_shortage', label: 'Недостача маркетплейса' },
];

/** Сегодня по календарю Москвы — той же зоне, в которой фильтруется лента. */
function todayIso(): string {
  return moscowDateString(new Date());
}

function newLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    itemId: '',
    qty: '1',
    priceRub: '',
    isEstimated: false,
    expiresAt: '',
  };
}

export function StockDocDialog({
  open,
  kind,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: StockDocKindUi;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [docDate, setDocDate] = useState(todayIso());
  const [supplier, setSupplier] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [reason, setReason] = useState<string>('expired');
  const [extraRub, setExtraRub] = useState('');
  const [extraAlloc, setExtraAlloc] = useState<'by_value' | 'by_qty' | 'none'>('by_value');
  const [priceIncludesVat, setPriceIncludesVat] = useState(true);
  const [vatRateBp, setVatRateBp] = useState('0');
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [itemsRes, supRes] = await Promise.all([
      stockFetch<{ items: Item[] }>('/api/stock/items?limit=1000'),
      stockFetch<{ suppliers: string[] }>('/api/stock/docs?suppliers=1'),
    ]);
    if (itemsRes.ok) setItems(itemsRes.data.items);
    if (supRes.ok) setSuppliers(supRes.data.suppliers);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDocDate(todayIso());
    setLines([newLine()]);
    load();
  }, [open, load]);

  // Превью = payload: тот же парсер, те же копейки, тот же отбор строк.
  const totalKopecks = useMemo(
    () =>
      linesTotalKopecks(
        lines
          .filter((l) => l.itemId)
          // Списание уходит на сервер с нулевой ценой — в превью тоже.
          .map((l) => ({ qty: l.qty, priceRub: kind === 'writeoff' ? '' : l.priceRub })),
      ) + (kind === 'purchase' ? rublesToKopecks(extraRub) : 0),
    [lines, extraRub, kind],
  );

  const canSave = lines.some((l) => l.itemId && parseQty(l.qty) > 0);

  async function submit(post: boolean) {
    const payloadLines = lines
      .filter((l) => l.itemId && parseQty(l.qty) > 0)
      .map((l) => ({
        itemId: l.itemId,
        direction: kind === 'writeoff' ? ('out' as const) : ('in' as const),
        qty: parseQty(l.qty),
        unitPriceKopecks: kind === 'writeoff' ? 0 : rublesToKopecks(l.priceRub),
        vatRateBp: kind === 'writeoff' ? 0 : Math.max(0, Number(vatRateBp) || 0),
        isEstimated: l.isEstimated,
        expiresAt: l.expiresAt || null,
      }));
    if (payloadLines.length === 0) return;

    setSaving(true);
    setError(null);
    const res = await stockFetch<{ docId: string; number?: string | null }>(
      '/api/stock/docs',
      {
        method: 'POST',
        body: JSON.stringify({
          kind,
          docDate,
          supplier: supplier.trim(),
          docNumber: docNumber.trim() || null,
          priceIncludesVat,
          extraCostKopecks: kind === 'purchase' ? rublesToKopecks(extraRub) : 0,
          extraAlloc,
          reason: kind === 'writeoff' ? reason : null,
          lines: payloadLines,
          post,
        }),
      },
    );
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
          <DialogTitle>{KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription>
            {kind === 'purchase'
              ? 'Дата и строки — всё, что нужно. Доставку можно указать одной суммой: она разнесётся по строкам и попадёт в себестоимость.'
              : kind === 'writeoff'
                ? 'Списание уходит отдельной статьёй потерь и НЕ попадает в себестоимость проданного.'
                : 'Возврат приходуется на свой склад по указанной цене.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
            <label className="min-w-0 space-y-1">
              <span className="text-[11px] text-muted-foreground">Дата операции</span>
              <Input
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
              />
            </label>
            {kind !== 'writeoff' && (
              <>
                <label className="min-w-0 space-y-1">
                  <span className="text-[11px] text-muted-foreground">Поставщик</span>
                  <Input
                    list="stock-suppliers"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="ООО «Поставщик»"
                  />
                  <datalist id="stock-suppliers">
                    {suppliers.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="text-[11px] text-muted-foreground">Накладная №</span>
                  <Input
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="УПД-123"
                  />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="text-[11px] text-muted-foreground">Ставка НДС</span>
                  <Select value={vatRateBp} onValueChange={setVatRateBp}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Без НДС</SelectItem>
                      <SelectItem value="500">5 %</SelectItem>
                      <SelectItem value="700">7 %</SelectItem>
                      <SelectItem value="1000">10 %</SelectItem>
                      <SelectItem value="2000">20 %</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </>
            )}
            {kind === 'writeoff' && (
              <label className="min-w-0 space-y-1">
                <span className="text-[11px] text-muted-foreground">Причина</span>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>

          <div className="min-w-0 overflow-x-auto rounded border border-border/60">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Товар</th>
                  <th className="w-20 px-2 py-1.5 text-right font-medium">Кол-во</th>
                  {kind !== 'writeoff' && (
                    <>
                      <th className="w-28 px-2 py-1.5 text-right font-medium">Цена, ₽</th>
                      <th className="w-24 px-2 py-1.5 text-center font-medium" title="Цена по памяти — пометится во всех отчётах">
                        Оценочно
                      </th>
                      <th className="w-32 px-2 py-1.5 text-left font-medium">Годен до</th>
                    </>
                  )}
                  <th className="w-8 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {lines.map((line, idx) => (
                  <tr key={line.key}>
                    <td className="min-w-0 px-2 py-1">
                      <Select
                        value={line.itemId || undefined}
                        onValueChange={(v) =>
                          setLines((prev) =>
                            prev.map((l) => (l.key === line.key ? { ...l, itemId: v } : l)),
                          )
                        }
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
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) =>
                              l.key === line.key ? { ...l, qty: e.target.value } : l,
                            ),
                          )
                        }
                        className="h-7 w-full rounded border border-border bg-background px-1 text-right tabular-nums"
                      />
                    </td>
                    {kind !== 'writeoff' && (
                      <>
                        <td className="px-2 py-1">
                          <input
                            inputMode="decimal"
                            value={line.priceRub}
                            placeholder="0"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && idx === lines.length - 1) {
                                e.preventDefault();
                                setLines((prev) => [...prev, newLine()]);
                              }
                            }}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, priceRub: e.target.value }
                                    : l,
                                ),
                              )
                            }
                            className="h-7 w-full rounded border border-border bg-background px-1 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-primary"
                            checked={line.isEstimated}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, isEstimated: e.target.checked }
                                    : l,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="date"
                            value={line.expiresAt}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.key === line.key
                                    ? { ...l, expiresAt: e.target.value }
                                    : l,
                                ),
                              )
                            }
                            className="h-7 w-full rounded border border-border bg-background px-1 text-[11px]"
                          />
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        className="text-muted-foreground transition hover:text-destructive"
                        onClick={() =>
                          setLines((prev) =>
                            prev.length === 1
                              ? [newLine()]
                              : prev.filter((l) => l.key !== line.key),
                          )
                        }
                        title="Удалить строку"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus className="h-3.5 w-3.5" /> Строка
            </Button>

            {kind === 'purchase' && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Доставка, ₽</span>
                  <Input
                    inputMode="decimal"
                    value={extraRub}
                    onChange={(e) => setExtraRub(e.target.value)}
                    className="w-28"
                    placeholder="0"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Разнести</span>
                  <Select
                    value={extraAlloc}
                    onValueChange={(v) => setExtraAlloc(v as typeof extraAlloc)}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_value">По стоимости</SelectItem>
                      <SelectItem value="by_qty">По количеству</SelectItem>
                      <SelectItem value="none">Не разносить</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-primary"
                    checked={priceIncludesVat}
                    onChange={(e) => setPriceIncludesVat(e.target.checked)}
                  />
                  Цены с НДС
                </label>
              </div>
            )}
          </div>

          <div className="text-right text-[13px] font-medium tabular-nums">
            Итого: {formatMoney(totalKopecks, true)} ₽
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="outline" onClick={() => submit(false)} disabled={saving || !canSave}>
            Черновик
          </Button>
          <Button onClick={() => submit(true)} disabled={saving || !canSave}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Провести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
