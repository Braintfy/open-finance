// PURPOSE: Multi-select кластеров FBS Ozon с долями (%).
// Заменяет single-warehouse DropdownSelect — соответствует референсу
// синий-рассвет.рф: пользователь выбирает несколько кластеров и задаёт
// долю каждого, логистика считается weighted-sum (см. computeLogistics).
'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  FBS_CLUSTERS,
  FBS_CLUSTER_BY_KEY,
  OZON_CLUSTER_PRESETS,
} from '@/lib/unit-economics/ozon/tariffs-2026-04-07';
import type { OzonFbsClusterShare } from '@/lib/unit-economics/types';

type Props = {
  label?: string;
  value: OzonFbsClusterShare[] | undefined;
  onChange: (next: OzonFbsClusterShare[]) => void;
  disabled?: boolean;
  triggerClassName?: string;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

function evenShares(keys: readonly string[]): OzonFbsClusterShare[] {
  if (keys.length === 0) return [];
  const each = Math.floor(100 / keys.length);
  const remainder = 100 - each * keys.length;
  return keys.map((key, i) => ({ key, sharePct: each + (i < remainder ? 1 : 0) }));
}

function summarizeTrigger(value: OzonFbsClusterShare[]): { text: string; sum: number } {
  if (!value || value.length === 0) {
    return { text: 'Выберите кластеры', sum: 0 };
  }
  const sum = value.reduce((acc, c) => acc + (c.sharePct || 0), 0);
  const sorted = [...value].sort((a, b) => b.sharePct - a.sharePct);
  const top = sorted.slice(0, 2);
  const rest = sorted.length - top.length;
  const parts = top.map((c) => {
    const label = FBS_CLUSTER_BY_KEY[c.key]?.label ?? c.key;
    return `${label} ${c.sharePct}%`;
  });
  if (rest > 0) parts.push(`+${rest}`);
  return { text: parts.join(' · '), sum };
}

export function ClusterSelector({
  label = 'Кластеры FBS',
  value,
  onChange,
  disabled,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);

  const selected = useMemo<Map<string, number>>(
    () => new Map((value ?? []).map((c) => [c.key, c.sharePct])),
    [value],
  );

  const summary = useMemo(() => summarizeTrigger(value ?? []), [value]);
  const sumIsValid = Math.abs(summary.sum - 100) < 0.5;

  function commit(map: Map<string, number>) {
    const next: OzonFbsClusterShare[] = [];
    for (const [key, sharePct] of map) {
      if (sharePct > 0) next.push({ key, sharePct });
    }
    onChange(next);
  }

  function toggleCluster(key: string) {
    const next = new Map(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      // Новый кластер получает оставшийся «свободный» % или равную долю.
      const currentSum = Array.from(next.values()).reduce((a, b) => a + b, 0);
      const free = Math.max(0, 100 - currentSum);
      next.set(key, free > 0 ? free : 10);
    }
    commit(next);
  }

  function setShare(key: string, share: number) {
    const next = new Map(selected);
    next.set(key, clamp(share, 0, 100));
    commit(next);
  }

  function applyPreset(keys: readonly string[]) {
    commit(new Map(evenShares(keys).map((c) => [c.key, c.sharePct])));
  }

  function clearAll() {
    onChange([]);
  }

  function normalize() {
    if (selected.size === 0) return;
    const total = Array.from(selected.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) {
      applyPreset(Array.from(selected.keys()));
      return;
    }
    const next = new Map<string, number>();
    let acc = 0;
    const keys = Array.from(selected.keys());
    keys.forEach((key, i) => {
      const isLast = i === keys.length - 1;
      const raw = (selected.get(key) ?? 0) / total * 100;
      const rounded = isLast ? Math.max(0, 100 - acc) : Math.round(raw);
      next.set(key, rounded);
      acc += rounded;
    });
    commit(next);
  }

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-muted-foreground">{label}:</span>}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              'inline-flex h-6 min-w-[14rem] max-w-[22rem] items-center justify-between gap-1 rounded border bg-background px-2 text-[11px] font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40',
              sumIsValid || (value?.length ?? 0) === 0
                ? 'border-border/60 text-foreground'
                : 'border-amber-500/60 text-amber-700 dark:text-amber-400',
              triggerClassName,
            )}
            title={`${summary.text}${(value?.length ?? 0) > 0 ? ` · сумма ${summary.sum}%` : ''}`}
          >
            <span className="min-w-0 flex-1 truncate text-left">{summary.text}</span>
            {(value?.length ?? 0) > 0 && (
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-[10px] tabular-nums',
                  sumIsValid
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                )}
              >
                {summary.sum}%
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[420px] p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => applyPreset(OZON_CLUSTER_PRESETS.allRf)}>
                Все РФ
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => applyPreset(OZON_CLUSTER_PRESETS.topRf5)}>
                Топ-5
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => applyPreset(OZON_CLUSTER_PRESETS.topRf10)}>
                Топ-10
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => applyPreset(OZON_CLUSTER_PRESETS.geography)}>
                География
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={clearAll}>
                Снять все
              </Button>
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-2">
            <div className="grid grid-cols-1 gap-0.5">
              {FBS_CLUSTERS.map((cluster) => {
                const isOn = selected.has(cluster.key);
                const share = selected.get(cluster.key) ?? 0;
                return (
                  <div
                    key={cluster.key}
                    className={cn(
                      'group flex items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors',
                      isOn ? 'bg-accent/50' : 'hover:bg-accent/30',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleCluster(cluster.key)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px]',
                          isOn
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background',
                        )}
                      >
                        {isOn ? '✓' : ''}
                      </span>
                      <span className="truncate">{cluster.label}</span>
                      <span
                        className={cn(
                          'ml-auto shrink-0 rounded px-1 text-[9px] uppercase tracking-wider',
                          cluster.local
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                        )}
                        title={cluster.local ? 'Локальный кластер' : 'Нелокальный (×1.25 к логистике)'}
                      >
                        {cluster.local ? 'local' : 'remote'}
                      </span>
                    </button>
                    {isOn && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={share}
                          onChange={(e) => setShare(cluster.key, Number(e.target.value))}
                          className="h-6 w-14 rounded border border-border/60 bg-background px-1 text-right text-[11px] tabular-nums focus:border-primary focus:outline-none"
                        />
                        <span className="text-[10px] text-muted-foreground">%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-3 py-2 text-[11px]">
            <span
              className={cn(
                'tabular-nums',
                sumIsValid ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
              )}
            >
              Сумма долей: {summary.sum}% {sumIsValid ? '✓' : '(должно быть 100%)'}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={normalize}
              disabled={selected.size === 0}
              title="Пропорционально привести сумму к 100%"
            >
              Нормализовать
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
