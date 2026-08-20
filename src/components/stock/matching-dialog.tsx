// PURPOSE: Экран сопоставления «товар ↔ SKU канала» — шаг 3 переноса с бумаги
// (docs/STOCK_MODULE_DESIGN.md §8). Здесь закрывается дыра «сшивки нет ни у
// одного из 79 товаров» — один раз, руками, с подтверждением каждой строки.
//
// ДВА ПРАВИЛА, КОТОРЫЕ НЕЛЬЗЯ СМЯГЧАТЬ:
//   1. Автоподбор (src/lib/stock/links.ts) МОЛЧИТ при неоднозначности и при
//      расхождении дозировки. Пустая строка лучше, чем тихая сшивка
//      «Спермидин 500 мг» с «Спермидин 250 мг» — она отравит себестоимость навсегда.
//   2. qty_per_unit спрашивается ЗДЕСЬ и только здесь — это единственный момент,
//      когда человек помнит, что «3 банки» это набор (§8 шаг 3, §10 риск 6).

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Plus, Save } from 'lucide-react';
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
import { stockFetch } from './stock-api';

type Candidate = {
  itemId: string;
  source: string;
  confidence: number;
  qtyPerUnit: number;
  reason: string;
};

type ScreenRow = {
  externalId: string;
  externalSku: string | null;
  name: string | null;
  barcode: string | null;
  accountId: string | null;
  channelQty: number;
  linkedItemId: string | null;
  suggestion: (Candidate & { ambiguous: boolean }) | null;
  candidates: Candidate[];
};

type ScreenResponse = {
  rows: ScreenRow[];
  items: Array<{ id: string; sku: string; name: string }>;
};

/** Значение «не сопоставлять» в Select — пустая строка в Radix запрещена. */
const NONE = '__none__';

export function MatchingDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [data, setData] = useState<ScreenResponse | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [qtyPerUnit, setQtyPerUnit] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await stockFetch<ScreenResponse>('/api/stock/links?mode=screen');
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setData(res.data);
    // Предзаполняем ТОЛЬКО однозначные автоподборы: неоднозначные остаются
    // пустыми и ждут человека.
    const nextChoice: Record<string, string> = {};
    const nextQty: Record<string, number> = {};
    for (const row of res.data.rows) {
      if (row.suggestion) {
        nextChoice[row.externalId] = row.suggestion.itemId;
        nextQty[row.externalId] = row.suggestion.qtyPerUnit;
      } else {
        nextQty[row.externalId] = 1;
      }
    }
    setChoice(nextChoice);
    setQtyPerUnit(nextQty);
  }, []);

  useEffect(() => {
    if (open) {
      setNotice(null);
      load();
    }
  }, [open, load]);

  const itemById = useMemo(
    () => new Map((data?.items ?? []).map((i) => [i.id, i])),
    [data],
  );

  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.externalId.toLowerCase().includes(q) ||
        (r.name ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  const readyCount = useMemo(
    () => Object.values(choice).filter((v) => v && v !== NONE).length,
    [choice],
  );

  async function save() {
    const links = Object.entries(choice)
      .filter(([, itemId]) => itemId && itemId !== NONE)
      .map(([externalId, itemId]) => {
        const row = data?.rows.find((r) => r.externalId === externalId);
        return {
          itemId,
          channel: 'ozon' as const,
          scopeKey: row?.accountId ?? '-',
          externalId,
          externalSku: row?.externalSku ?? null,
          qtyPerUnit: Math.max(1, qtyPerUnit[externalId] ?? 1),
          accountId: row?.accountId ?? null,
          matchSource: 'manual' as const,
          matchConfidence: 100,
        };
      });
    if (links.length === 0) return;

    setSaving(true);
    setError(null);
    const res = await stockFetch<{ saved: number }>('/api/stock/links', {
      method: 'POST',
      body: JSON.stringify({ links }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(`Сохранено сшивок: ${res.data.saved}`);
    onDone();
    load();
  }

  async function createItem(row: ScreenRow) {
    setSaving(true);
    setError(null);
    const res = await stockFetch<{ itemId: string }>('/api/stock/links', {
      method: 'POST',
      body: JSON.stringify({
        createItem: {
          sku: row.externalId,
          name: row.name ?? row.externalId,
          barcode: row.barcode,
          link: {
            channel: 'ozon',
            scopeKey: row.accountId ?? '-',
            externalId: row.externalId,
            externalSku: row.externalSku,
            qtyPerUnit: Math.max(1, qtyPerUnit[row.externalId] ?? 1),
            accountId: row.accountId,
            matchSource: 'manual',
            matchConfidence: 100,
          },
        },
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
    load();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Сопоставление с каналом
          </DialogTitle>
          <DialogDescription>
            Слева — позиции Ozon без сшивки, справа — наша номенклатура. Автоподбор
            заполнил только те строки, где совпадение однозначно; остальные решает
            человек.
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

          <div className="flex items-center gap-2">
            <Input
              placeholder="Поиск по артикулу или названию"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Готово к сохранению: {readyCount}
            </span>
          </div>

          <div className="max-h-[50vh] min-w-0 overflow-auto rounded border border-border/60">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Подбираем кандидатов…
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-muted-foreground">
                Несопоставленных позиций нет — весь канал сшит.
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 z-10 isolate bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Позиция канала</th>
                    <th className="w-20 px-2 py-1.5 text-right font-medium">Остаток</th>
                    <th className="w-[38%] px-2 py-1.5 text-left font-medium">Наш товар</th>
                    <th className="w-20 px-2 py-1.5 text-right font-medium">Ед. в карт.</th>
                    <th className="w-20 px-2 py-1.5 text-left font-medium">Подбор</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {visible.map((row) => {
                    const value = choice[row.externalId] ?? NONE;
                    const options = row.candidates.length > 0 ? row.candidates : [];
                    const optionIds = new Set(options.map((c) => c.itemId));
                    return (
                      <tr key={row.externalId}>
                        <td className="min-w-0 px-2 py-1.5">
                          <div className="line-clamp-1">{row.name ?? row.externalId}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {row.externalId}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.channelQty.toLocaleString('ru-RU')}
                        </td>
                        <td className="min-w-0 px-2 py-1.5">
                          <div className="flex min-w-0 items-center gap-1">
                            <Select
                              value={value}
                              onValueChange={(v) => {
                                setChoice((prev) => ({ ...prev, [row.externalId]: v }));
                                const cand = options.find((c) => c.itemId === v);
                                if (cand) {
                                  setQtyPerUnit((prev) => ({
                                    ...prev,
                                    [row.externalId]: cand.qtyPerUnit,
                                  }));
                                }
                              }}
                            >
                              <SelectTrigger className="h-7 min-w-0 flex-1 text-[12px]">
                                <SelectValue placeholder="Не сопоставлено" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>Не сопоставлять</SelectItem>
                                {options.map((c) => (
                                  <SelectItem key={c.itemId} value={c.itemId}>
                                    {itemById.get(c.itemId)?.name ?? c.itemId} ·{' '}
                                    {c.confidence}%
                                  </SelectItem>
                                ))}
                                {(data?.items ?? [])
                                  .filter((i) => !optionIds.has(i.id))
                                  .slice(0, 200)
                                  .map((i) => (
                                    <SelectItem key={i.id} value={i.id}>
                                      {i.name || i.sku}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 px-1.5"
                              title="Завести новый товар из этой позиции"
                              onClick={() => createItem(row)}
                              disabled={saving}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={qtyPerUnit[row.externalId] ?? 1}
                            onChange={(e) =>
                              setQtyPerUnit((prev) => ({
                                ...prev,
                                [row.externalId]: Math.max(1, Number(e.target.value) || 1),
                              }))
                            }
                            className="h-6 w-14 rounded border border-border bg-background px-1 text-right text-[12px] tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                          {row.suggestion ? row.suggestion.reason : 'решает человек'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={save} disabled={saving || readyCount === 0}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Сохранить сшивки ({readyCount})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
