// PURPOSE: Wizard добавления блока — выбор типа → настройка параметров/внешнего вида/размера → создать
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Sparkles, Store, ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listAllBlocks, listRecommendedForPage } from '@/lib/blocks/registry';
import type { BlockAppearance, BlockCategory, BlockDef } from '@/lib/blocks/types';
import { AppearanceForm, SizeForm } from './block-settings-dialog';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  stats: 'KPI / Статистика',
  tables: 'Таблицы',
  charts: 'Графики',
  custom: 'Прочее',
};

export type AddBlockResult = {
  type: string;
  config?: Record<string, unknown>;
  appearance?: BlockAppearance;
  size: { w: number; h: number };
};

export function AddBlockDialog({
  open,
  pageKey,
  existingTypes,
  onAdd,
  onClose,
}: {
  open: boolean;
  pageKey: string;
  existingTypes: string[];
  onAdd: (result: AddBlockResult) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'pick' | 'configure'>('pick');
  const [picked, setPicked] = useState<BlockDef | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [appearance, setAppearance] = useState<BlockAppearance>({});
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 4, h: 2 });
  const [tab, setTab] = useState<'params' | 'appearance' | 'size'>('params');

  const recommended = listRecommendedForPage(pageKey);
  const all = listAllBlocks();

  function reset() {
    setStep('pick');
    setPicked(null);
    setConfig({});
    setAppearance({});
    setSize({ w: 4, h: 2 });
    setTab('params');
  }

  function pickBlock(def: BlockDef) {
    setPicked(def);
    setConfig(def.defaultConfig?.() ?? {});
    setAppearance({});
    setSize({ w: def.defaultSize.w, h: def.defaultSize.h });
    setTab(def.SettingsForm ? 'params' : 'appearance');
    setStep('configure');
  }

  function submit() {
    if (!picked) return;
    onAdd({
      type: picked.type,
      config: Object.keys(config).length > 0 ? config : undefined,
      appearance: hasAppearance(appearance) ? appearance : undefined,
      size,
    });
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        {step === 'pick' ? (
          <PickStep
            onPick={pickBlock}
            recommended={recommended}
            all={all}
            existingTypes={existingTypes}
          />
        ) : (
          <ConfigureStep
            def={picked!}
            config={config}
            appearance={appearance}
            size={size}
            tab={tab}
            onTabChange={setTab}
            onConfigChange={setConfig}
            onAppearanceChange={setAppearance}
            onSizeChange={setSize}
            onBack={() => setStep('pick')}
            onSubmit={submit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function hasAppearance(a: BlockAppearance): boolean {
  return Boolean(a.title || a.borderColor || a.accentColor || a.icon);
}

// ============================================================================
// Step 1: pick block
// ============================================================================

function PickStep({
  recommended,
  all,
  existingTypes,
  onPick,
}: {
  recommended: BlockDef[];
  all: BlockDef[];
  existingTypes: string[];
  onPick: (def: BlockDef) => void;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(recommended.length === 0);

  const matches = (b: BlockDef, q: string) =>
    !q ||
    b.displayName.toLowerCase().includes(q) ||
    b.description.toLowerCase().includes(q) ||
    b.type.toLowerCase().includes(q) ||
    (b.tags ?? []).some((t) => t.toLowerCase().includes(q));

  const q = query.trim().toLowerCase();

  const filteredRecommended = useMemo(
    () => recommended.filter((b) => matches(b, q)),
    [recommended, q],
  );
  const filteredAll = useMemo(
    () => all.filter((b) => matches(b, q)),
    [all, q],
  );

  // В режиме «все» исключаем рекомендованные, чтобы они не дублировались
  const recommendedTypes = new Set(recommended.map((b) => b.type));
  const otherBlocks = useMemo(
    () => filteredAll.filter((b) => !recommendedTypes.has(b.type)),
    [filteredAll, recommendedTypes],
  );

  const groupByCategory = (blocks: BlockDef[]) =>
    blocks.reduce<Record<BlockCategory, BlockDef[]>>(
      (acc, b) => {
        (acc[b.category] ??= []).push(b);
        return acc;
      },
      { stats: [], tables: [], charts: [], custom: [] },
    );

  const otherGrouped = groupByCategory(otherBlocks);
  const isQuerying = q.length > 0;
  const expanded = showAll || isQuerying;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Добавить блок</DialogTitle>
        <DialogDescription>
          Выберите тип. На следующем шаге настроите параметры и внешний вид.
        </DialogDescription>
      </DialogHeader>

      <Input
        placeholder="Поиск по названию, описанию или тегу…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {recommended.length > 0 && (
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                Рекомендуемые
              </h3>
              {!isQuerying && recommended.length < all.length && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showAll ? 'Свернуть' : 'Показать все'}
                </button>
              )}
            </div>
            <BlockGrid blocks={filteredRecommended} existingTypes={existingTypes} onPick={onPick} />
            {filteredRecommended.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Среди рекомендованных ничего не найдено
              </p>
            )}
          </section>
        )}

        {expanded &&
          (Object.keys(otherGrouped) as BlockCategory[]).map((cat) => {
            const items = otherGrouped[cat];
            if (items.length === 0) return null;
            return (
              <section key={cat} className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </h3>
                <BlockGrid blocks={items} existingTypes={existingTypes} onPick={onPick} />
              </section>
            );
          })}

        {expanded && filteredAll.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Ничего не нашлось. Попробуйте другой запрос.
          </p>
        )}
      </div>

      <DialogFooter className="border-t pt-3 text-[11px] text-muted-foreground sm:justify-between">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1 text-primary transition-colors hover:underline"
        >
          <Store className="h-3.5 w-3.5" />
          Открыть Маркет блоков
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </DialogFooter>
    </>
  );
}

function BlockGrid({
  blocks,
  existingTypes,
  onPick,
}: {
  blocks: BlockDef[];
  existingTypes: string[];
  onPick: (def: BlockDef) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {blocks.map((def) => {
        const Icon = def.icon;
        const used = existingTypes.includes(def.type);
        return (
          <button
            key={def.type}
            type="button"
            onClick={() => onPick(def)}
            className="flex items-start gap-3 rounded-md border p-3 text-left transition hover:bg-accent"
          >
            <div className="rounded-md bg-muted p-2">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium">{def.displayName}</div>
                {used && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    уже на странице
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{def.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Step 2: configure
// ============================================================================

function ConfigureStep({
  def,
  config,
  appearance,
  size,
  tab,
  onTabChange,
  onConfigChange,
  onAppearanceChange,
  onSizeChange,
  onBack,
  onSubmit,
}: {
  def: BlockDef;
  config: Record<string, unknown>;
  appearance: BlockAppearance;
  size: { w: number; h: number };
  tab: 'params' | 'appearance' | 'size';
  onTabChange: (t: 'params' | 'appearance' | 'size') => void;
  onConfigChange: (c: Record<string, unknown>) => void;
  onAppearanceChange: (a: BlockAppearance) => void;
  onSizeChange: (s: { w: number; h: number }) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const tabs = [
    ...(def.SettingsForm ? [{ key: 'params' as const, label: 'Параметры' }] : []),
    { key: 'appearance' as const, label: 'Внешний вид' },
    { key: 'size' as const, label: 'Размер' },
  ];

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DialogTitle>{def.displayName}</DialogTitle>
        </div>
        <DialogDescription>{def.description}</DialogDescription>
      </DialogHeader>

      <div className="-mx-6 border-b px-6">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition',
                tab === t.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto pt-2">
        {tab === 'params' && def.SettingsForm && (
          <def.SettingsForm config={config} onChange={onConfigChange} />
        )}
        {tab === 'appearance' && (
          <AppearanceForm
            defaultTitle={def.displayName}
            defaultIcon={def.iconName ?? def.icon?.displayName ?? 'Square'}
            appearance={appearance}
            onChange={onAppearanceChange}
          />
        )}
        {tab === 'size' && (
          <SizeForm
            w={size.w}
            h={size.h}
            minW={def.minSize.w}
            minH={def.minSize.h}
            onChange={onSizeChange}
          />
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onBack}>
          Назад
        </Button>
        <Button onClick={onSubmit}>Создать блок</Button>
      </DialogFooter>
    </>
  );
}
