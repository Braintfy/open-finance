// PURPOSE: Диалог настроек синхронизации с Ozon для блока unit.ozon-multi-table.
// Позволяет выбрать магазин, политику конфликтов, ключ сопоставления и
// какие колонки заполнять из Ozon. Чистый UI — изменения сохраняются
// callback'ом onSave (внутрь config.sync блока).

'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Info,
  Link as LinkIcon,
  Loader2,
  Plug,
  ShoppingBag,
} from 'lucide-react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import type {
  OzonBlockSyncColumnMap,
  OzonBlockSyncSettings,
} from './ozon-sync-diff';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';

type FieldDescriptor = {
  key: keyof OzonBlockSyncColumnMap;
  label: string;
  source: string;
  /** Доп. предупреждение / hint о специфике. */
  note?: string;
  category: 'identity' | 'core' | 'advanced';
};

const FIELD_DESCRIPTORS: FieldDescriptor[] = [
  {
    key: 'article',
    label: 'Артикул',
    source: 'unit_products.article ← offer_id',
    category: 'identity',
  },
  {
    key: 'name',
    label: 'Название',
    source: 'unit_products.name ← /v3/product/info/list',
    category: 'identity',
  },
  {
    key: 'price',
    label: 'Цена',
    source: 'unit_products.price ← /v5/product/info/prices',
    category: 'core',
  },
  {
    key: 'stock',
    label: 'Остаток',
    source: 'sum(stock_marketplace + stock_own)',
    category: 'core',
  },
  {
    key: 'volumeL',
    label: 'Объём, л',
    source: 'volume_l ← depth × width × height',
    category: 'core',
  },
  {
    key: 'cost',
    label: 'Себестоимость',
    source: 'unit_products.cost',
    note: 'Ozon не отдаёт себестоимость — поле обычно остаётся равным 0. Включайте, только если вы уже сохраняли себестоимость через импорт XLSX.',
    category: 'core',
  },
  {
    key: 'commissionPct',
    label: 'Комиссия %',
    source: 'metadata.commissions (FBO/FBS по mode блока)',
    note: 'Комиссия берётся из текущего global.mode: при FBO — fboPct, при FBS — fbsPct.',
    category: 'advanced',
  },
  {
    key: 'salesPerMonth',
    label: 'Продаж/мес',
    source: 'COUNT(ozon_orders WHERE status=delivered AND order_created_at > 30d)',
    note: 'Считается только при включённом стейдже «Заказы» в /settings/integrations.',
    category: 'advanced',
  },
  {
    key: 'buyoutPct',
    label: 'Выкуп %',
    source: 'delivered / (delivered + cancelled + returned) за 90 дней',
    note: 'Требует ≥5 заказов в окне 90 дней, иначе пусто (статистически нерепрезентативно).',
    category: 'advanced',
  },
];

type Policy = OzonBlockSyncSettings['conflictPolicy'];
type MatchBy = OzonBlockSyncSettings['matchBy'];

const POLICY_OPTIONS: Array<{ value: Policy; title: string; hint: string }> = [
  {
    value: 'fill-empty',
    title: 'Дополнить пустые ячейки',
    hint: 'Безопасно. Уже введённые вами значения не трогаем. Заполняются только пустые поля.',
  },
  {
    value: 'overwrite',
    title: 'Перезаписать все значения',
    hint: 'Использовать Ozon как «источник правды». Все ваши ручные значения в перечисленных колонках будут заменены.',
  },
  {
    value: 'skip',
    title: 'Пропустить заполненные строки',
    hint: 'Радикально-безопасно. Если в строке есть хоть одно значение (кроме артикула/названия) — строку не трогаем целиком.',
  },
];

export function OzonSyncSettingsDialog({
  open,
  initial,
  blockMode,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: OzonBlockSyncSettings;
  blockMode: 'fbo' | 'fbs';
  onClose: () => void;
  onSave: (next: OzonBlockSyncSettings) => void;
}) {
  const [draft, setDraft] = useState<OzonBlockSyncSettings>(initial);
  const { accounts, loading } = useMarketplaceAccounts({ marketplace: 'ozon' });

  // Reset draft if dialog re-opens with new initial
  useEffect(() => {
    if (open) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Validate accountId still exists; fallback to first account if не существует.
  useEffect(() => {
    if (!open || loading || accounts.length === 0) return;
    const stillExists = draft.accountId && accounts.some((a) => a.id === draft.accountId);
    if (!stillExists) {
      setDraft((d) => ({ ...d, accountId: accounts[0]?.id ?? null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, accounts]);

  const accountSelected = accounts.find((a) => a.id === draft.accountId);
  const accountInvalid = !!(draft.accountId && !accountSelected);

  function updateColumn(key: keyof OzonBlockSyncColumnMap, value: boolean) {
    setDraft({ ...draft, columnMap: { ...draft.columnMap, [key]: value } });
  }

  function selectAll(category: FieldDescriptor['category'], value: boolean) {
    const patch: Partial<OzonBlockSyncColumnMap> = {};
    for (const f of FIELD_DESCRIPTORS.filter((d) => d.category === category)) {
      patch[f.key] = value;
    }
    setDraft({ ...draft, columnMap: { ...draft.columnMap, ...patch } });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            Настройки синхронизации с Ozon
          </DialogTitle>
          <DialogDescription>
            Определите, какой магазин и какие колонки заполнять при нажатии
            «Синхронизировать». Перед записью вы увидите предпросмотр изменений.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
          <Section title="Магазин" icon={<ShoppingBag className="h-3.5 w-3.5" />}>
            {loading ? (
              <div className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 p-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка магазинов…
              </div>
            ) : accounts.length === 0 ? (
              <div className="space-y-2 rounded border border-amber-400/50 bg-amber-50 p-2 text-[12px] dark:bg-amber-950/40">
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Ни один Ozon-магазин не подключён.
                </div>
                <Link
                  href="/settings/integrations"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
                >
                  <LinkIcon className="h-3 w-3" />
                  Подключить в Настройках → Интеграции
                </Link>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map((a) => {
                    const active = draft.accountId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, accountId: a.id })}
                        className={
                          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                          (active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/60 bg-background hover:bg-accent')
                        }
                      >
                        <span
                          className={
                            'h-2 w-2 rounded-full ' +
                            (a.status === 'active'
                              ? 'bg-emerald-500'
                              : a.status === 'error'
                                ? 'bg-red-500'
                                : 'bg-muted')
                          }
                        />
                        <span className="font-medium">{a.name}</span>
                        <span className="text-muted-foreground">· {a.clientId}</span>
                      </button>
                    );
                  })}
                </div>
                {accountInvalid && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" />
                    Сохранённый аккаунт удалён. Выберите другой выше.
                  </div>
                )}
              </>
            )}
          </Section>

          <Section title="Политика конфликтов">
            <div className="space-y-1.5">
              {POLICY_OPTIONS.map((opt) => {
                const active = draft.conflictPolicy === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, conflictPolicy: opt.value })}
                    className={
                      'flex w-full items-start gap-2 rounded-md border p-2 text-left transition-colors ' +
                      (active
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 bg-card hover:bg-accent/30')
                    }
                  >
                    <div
                      className={
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors ' +
                        (active
                          ? 'border-primary bg-primary'
                          : 'border-border bg-background')
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium">{opt.title}</div>
                      <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-md border border-border/60 bg-muted/20 p-2 text-[12px]">
              <div>
                <div className="font-medium">Считать «0» пустым значением</div>
                <div className="text-[11px] text-muted-foreground">
                  Применяется только к «Дополнить пустые». 0 ₽ / 0 шт → перезатираются.
                </div>
              </div>
              <Switch
                checked={draft.treatZeroAsEmpty}
                onCheckedChange={(v) => setDraft({ ...draft, treatZeroAsEmpty: v })}
              />
            </div>
          </Section>

          <Section title="Как сопоставлять строки">
            <div className="flex flex-wrap gap-1.5">
              {(['article', 'sku'] as MatchBy[]).map((mb) => {
                const active = draft.matchBy === mb;
                return (
                  <button
                    key={mb}
                    type="button"
                    onClick={() => setDraft({ ...draft, matchBy: mb })}
                    className={
                      'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                      (active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 bg-background hover:bg-accent')
                    }
                  >
                    {mb === 'article' ? 'По артикулу (offer_id)' : 'По SKU (product_id)'}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Артикул — стандартный режим. SKU подходит, если ваши артикулы
              менялись со временем, но product_id Ozon сохранялся.
            </p>
          </Section>

          <Section
            title="Какие колонки заполнять"
            badge={
              <span className="text-[10px] text-muted-foreground">
                FBO/FBS режим блока: <b>{blockMode.toUpperCase()}</b>
              </span>
            }
          >
            <ColumnGroup
              title="Идентификаторы"
              fields={FIELD_DESCRIPTORS.filter((f) => f.category === 'identity')}
              columnMap={draft.columnMap}
              onChange={updateColumn}
              onAll={(v) => selectAll('identity', v)}
            />
            <ColumnGroup
              title="Базовые данные"
              fields={FIELD_DESCRIPTORS.filter((f) => f.category === 'core')}
              columnMap={draft.columnMap}
              onChange={updateColumn}
              onAll={(v) => selectAll('core', v)}
            />
            <ColumnGroup
              title="Расширенные (по умолчанию выкл)"
              fields={FIELD_DESCRIPTORS.filter((f) => f.category === 'advanced')}
              columnMap={draft.columnMap}
              onChange={updateColumn}
              onAll={(v) => selectAll('advanced', v)}
            />
            <div className="mt-1 flex items-start gap-1.5 rounded border border-border/40 bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Сначала выполняется синхронизация с Ozon (см. /settings/integrations),
                потом данные применяются к ячейкам блока согласно политике выше.
                Перед записью вы увидите предпросмотр изменений.
              </span>
            </div>
          </Section>
        </div>

        <DialogFooter className="border-t border-border/40 pt-3">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            disabled={!draft.accountId && accounts.length > 0}
          >
            Сохранить настройки
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {icon}
            {title}
          </span>
        </div>
        {badge && <div className="ml-auto">{badge}</div>}
      </div>
      {children}
    </section>
  );
}

function ColumnGroup({
  title,
  fields,
  columnMap,
  onChange,
  onAll,
}: {
  title: string;
  fields: FieldDescriptor[];
  columnMap: OzonBlockSyncColumnMap;
  onChange: (key: keyof OzonBlockSyncColumnMap, value: boolean) => void;
  onAll: (value: boolean) => void;
}) {
  const allEnabled = fields.every((f) => columnMap[f.key]);
  return (
    <div className="rounded-md border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 px-2 py-1">
        <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </Label>
        <button
          type="button"
          onClick={() => onAll(!allEnabled)}
          className="text-[10px] text-primary hover:underline"
        >
          {allEnabled ? 'выключить все' : 'включить все'}
        </button>
      </div>
      <div className="divide-y divide-border/40">
        {fields.map((f) => (
          <div
            key={f.key}
            className="flex items-center gap-2 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium">{f.label}</div>
              <div className="truncate text-[11px] text-muted-foreground" title={f.source}>
                {f.source}
              </div>
              {f.note && (
                <div className="mt-0.5 flex items-start gap-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  <span>{f.note}</span>
                </div>
              )}
            </div>
            <Switch
              checked={columnMap[f.key]}
              onCheckedChange={(v) => onChange(f.key, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
