// PURPOSE: Диалог выбора одного товара из синхронизированных Ozon-товаров.
// Используется в unit-ozon-calculator: после Sync пользователь подбирает
// конкретный article и автозаполняет inputs (price, cost, volumeL).
//
// Источник данных: GET /api/unit-economics/products?marketplace=ozon.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Product = {
  id: string;
  article: string | null;
  name: string;
  priceKopecks: number;
  costKopecks: number;
  stockMarketplace: number;
  stockOwn: number;
  volumeL: number;
  metadata?: Record<string, unknown>;
};

export function OzonProductPickerDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: {
    article: string;
    name: string;
    priceRub: number;
    costRub: number;
    volumeL: number;
    commissionFboPct: number | null;
    commissionFbsPct: number | null;
  }) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/unit-economics/products?marketplace=ozon')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok) setProducts(data.products as Product[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 100);
    const q = query.toLowerCase();
    return products
      .filter(
        (p) =>
          (p.article ?? '').toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      )
      .slice(0, 100);
  }, [products, query]);

  function pick(p: Product) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const commissions = (meta.commissions ?? {}) as Record<string, unknown>;
    onPick({
      article: p.article ?? '',
      name: p.name,
      priceRub: p.priceKopecks / 100,
      costRub: p.costKopecks / 100,
      volumeL: p.volumeL / 100,
      commissionFboPct:
        typeof commissions.fboPct === 'number' ? (commissions.fboPct as number) : null,
      commissionFbsPct:
        typeof commissions.fbsPct === 'number' ? (commissions.fbsPct as number) : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Выбрать товар из Ozon</DialogTitle>
          <DialogDescription>
            Цена, себестоимость, объём и комиссии заполнятся из последней
            синхронизации. Себестоимость заполнится из БД (если задавали).
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Поиск по артикулу или названию"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-7"
            autoFocus
          />
        </div>

        <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto rounded border bg-card">
          {loading ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              Загрузка…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {products.length === 0
                ? 'Нет синхронизированных товаров. Запустите «Загрузить из Ozon».'
                : 'Ничего не найдено.'}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {p.name || '(без названия)'}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {p.article ?? '—'} · {(p.priceKopecks / 100).toLocaleString('ru-RU')} ₽ ·{' '}
                    Остаток {p.stockMarketplace + p.stockOwn}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
