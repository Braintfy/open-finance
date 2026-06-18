// PURPOSE: Блок «Курсы валют» — публикует свежие курсы (rate/RUB) выбранных валют
// для использования в @связать (например, =A1*@currency.usd для пересчёта цены).
// Источник по умолчанию — ЦБ РФ через cbr-xml-daily.ru. Lazy-refresh раз в 23h
// + кнопка ручного обновления в шапке блока.
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Banknote,
  ChevronDown,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import { useBlockValuePublisher } from '../values';
import { cn } from '@/lib/utils';
import type { CurrencyRate } from '@/lib/currency/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Популярные валюты для дефолтного списка в Settings.
 * Подобрано под аудиторию РФ (импорт из ЕС/Китая/Турции/ОАЭ + СНГ-расчёты).
 */
export const POPULAR_CODES: ReadonlyArray<{ code: string; label: string; hint?: string }> = [
  { code: 'USD', label: 'Доллар США', hint: 'базовая для импорта/экспорта' },
  { code: 'EUR', label: 'Евро', hint: 'импорт ЕС' },
  { code: 'CNY', label: 'Юань', hint: 'маркетплейсы, Китай' },
  { code: 'AED', label: 'Дирхам ОАЭ', hint: 'посредник для санкционного импорта' },
  { code: 'TRY', label: 'Турецкая лира', hint: 'хаб для расчётов' },
  { code: 'GBP', label: 'Фунт', hint: 'финансовые операции' },
  { code: 'JPY', label: 'Йена', hint: 'импорт техники' },
  { code: 'KZT', label: 'Тенге', hint: 'приграничная торговля' },
  { code: 'BYN', label: 'Белорусский рубль', hint: 'СНГ-расчёты' },
];

const DEFAULT_CODES = ['USD', 'EUR', 'CNY', 'AED'];
const DEFAULT_PRIMARY = 'USD';

// ============================================================================
// Schema
// ============================================================================

const ConfigSchema = z
  .object({
    codes: z.array(z.string()).optional(),
    primaryCode: z.string().optional(),
    showDelta: z.boolean().optional(),
    showPercent: z.boolean().optional(),
  })
  .passthrough();

type Config = {
  codes: string[];
  primaryCode: string;
  showDelta: boolean;
  showPercent: boolean;
};

function parseConfig(raw: unknown): Config {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  const data = parsed.success ? parsed.data : {};
  const codes =
    Array.isArray(data.codes) && data.codes.length > 0
      ? Array.from(new Set(data.codes.map((c) => c.toUpperCase()).filter(Boolean)))
      : [...DEFAULT_CODES];
  const primaryCode =
    data.primaryCode && codes.includes(data.primaryCode.toUpperCase())
      ? data.primaryCode.toUpperCase()
      : codes[0] ?? DEFAULT_PRIMARY;
  return {
    codes,
    primaryCode,
    showDelta: data.showDelta ?? true,
    showPercent: data.showPercent ?? true,
  };
}

function serializeConfig(cfg: Config): Record<string, unknown> {
  return {
    codes: cfg.codes,
    primaryCode: cfg.primaryCode,
    showDelta: cfg.showDelta,
    showPercent: cfg.showPercent,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatRate(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function deltaPercent(rate: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return ((rate - previous) / previous) * 100;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fieldKeyForCode(code: string): string {
  return code.toLowerCase();
}

function changeFieldKey(code: string): string {
  return `${fieldKeyForCode(code)}_change`;
}

// ============================================================================
// Hook: загрузка курсов
// ============================================================================

type RatesState = {
  rates: Record<string, CurrencyRate>;
  lastUpdatedAt: string | null;
  loading: boolean;
  error: string | null;
};

const initialState: RatesState = {
  rates: {},
  lastUpdatedAt: null,
  loading: true,
  error: null,
};

/**
 * Безопасный парсинг ответа: если сервер вернул HTML 500-страницу (как
 * Next.js делает при unhandled exception в route handler), `response.json()`
 * упадёт с "Unexpected end of JSON input". Сначала читаем как text, потом
 * пытаемся распарсить — даём пользователю осмысленное сообщение.
 */
async function parseJsonResponse(response: Response): Promise<{
  ok: true;
  data: unknown;
} | { ok: false; error: string }> {
  const text = await response.text();
  if (!text) {
    return {
      ok: false,
      error: `Пустой ответ сервера (HTTP ${response.status}). Возможно, не применена SQL-миграция \`drizzle/init/06-currency.sql\`.`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // Скорее всего HTML error page (500). Достанем заголовок если есть.
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const hint = titleMatch ? `: ${titleMatch[1].trim()}` : '';
    return {
      ok: false,
      error: `Сервер вернул не-JSON ответ${hint}. Проверьте логи и применение SQL-миграции \`drizzle/init/06-currency.sql\`.`,
    };
  }
}

function useCurrencyRates(): RatesState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<RatesState>(initialState);
  /** Mounted-flag — защита от setState после unmount (race в async fetch). */
  const mountedRef = useRef(true);
  /** Однократный авто-refresh: если БД пустая после первого load, дёргаем
   * refresh ровно ОДИН раз. Без этого guard'а легко получить рекурсию,
   * если refresh тоже возвращает пустой результат. */
  const triedAutoRefreshRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((updater: RatesState | ((prev: RatesState) => RatesState)) => {
    if (mountedRef.current) {
      setState(updater);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/currency/rates', { cache: 'no-store' });
      const parsed = await parseJsonResponse(response);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      const data = parsed.data as { ok?: boolean; error?: string; rates?: CurrencyRate[]; staleness?: { lastUpdatedAt?: string | null } };
      if (!data.ok) {
        throw new Error(data.error ?? `Не удалось загрузить курсы (HTTP ${response.status}).`);
      }
      const rates: Record<string, CurrencyRate> = {};
      for (const r of data.rates ?? []) {
        rates[r.code] = r;
      }
      safeSetState({
        rates,
        lastUpdatedAt: data.staleness?.lastUpdatedAt ?? null,
        loading: false,
        error: null,
      });
    } catch (error) {
      safeSetState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Ошибка загрузки',
      }));
    }
  }, [safeSetState]);

  const refresh = useCallback(async () => {
    safeSetState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch('/api/currency/rates/refresh', {
        method: 'POST',
        cache: 'no-store',
      });
      const parsed = await parseJsonResponse(response);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      const data = parsed.data as { ok?: boolean; error?: string; rates?: CurrencyRate[]; refreshedAt?: string };
      if (!data.ok) {
        throw new Error(data.error ?? `Не удалось обновить курсы (HTTP ${response.status}).`);
      }
      const rates: Record<string, CurrencyRate> = {};
      for (const r of data.rates ?? []) {
        rates[r.code] = r;
      }
      safeSetState({
        rates,
        lastUpdatedAt: data.refreshedAt ?? new Date().toISOString(),
        loading: false,
        error: null,
      });
    } catch (error) {
      safeSetState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Ошибка обновления',
      }));
    }
  }, [safeSetState]);

  useEffect(() => {
    load();
  }, [load]);

  // Авто-refresh при первом открытии, если БД пустая (БЕЗ ошибки).
  // `triedAutoRefreshRef` гарантирует ровно один авто-вызов за жизнь компонента.
  const isEmptyAndIdle =
    !state.loading &&
    !state.error &&
    Object.keys(state.rates).length === 0;
  useEffect(() => {
    if (isEmptyAndIdle && !triedAutoRefreshRef.current) {
      triedAutoRefreshRef.current = true;
      refresh();
    }
  }, [isEmptyAndIdle, refresh]);

  return { ...state, refresh };
}

// ============================================================================
// Render
// ============================================================================

function formatLastUpdated(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) {
    return `сегодня ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function RenderCurrencyRates({ instance }: BlockRenderProps) {
  // Memo обязателен: без него каждый рендер даёт НОВЫЕ ссылки на codes/primaryCode,
  // и зависимости useMemo ниже (visible, publishOutput) пересчитываются впустую.
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const density = useBlockDensity();
  const { rates, lastUpdatedAt, loading, error, refresh } = useCurrencyRates();
  useReportBlockLoading(loading);
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'Курсы валют';

  const visible = useMemo(
    () =>
      config.codes
        .map((code) => rates[code])
        .filter((r): r is CurrencyRate => Boolean(r)),
    [config.codes, rates],
  );

  const primaryRate = rates[config.primaryCode];

  // ── Publisher: курсы доступны через @блок.usd, @блок.eur, ... ──
  const publishOutput = useMemo(() => {
    const out: Record<string, number | string | null> = {
      label: title,
      value: primaryRate?.rateRub ?? null,
      // primary также доступен под именем своего code (для удобства, и чтобы
      // value не «пропадал», когда выбрана другая основная валюта)
    };
    const labels: string[] = [];
    for (const code of config.codes) {
      const rate = rates[code];
      const key = fieldKeyForCode(code);
      out[key] = rate?.rateRub ?? null;
      labels.push(`${key}=${code} (₽)`);
      if (rate) {
        const delta = deltaPercent(rate.rateRub, rate.previousRub);
        if (delta !== null) {
          const changeKey = changeFieldKey(code);
          out[changeKey] = Number(delta.toFixed(4));
          labels.push(`${changeKey}=${code} Δ%`);
        }
      }
    }
    out.__labels = labels.join(',');
    // НЕ публикуем __money: курс — обычное число (RUB за 1 единицу),
    // не money-формат. Если потребитель хочет получить рубли, он умножает
    // money-ячейку на курс — формат остаётся у потребителя.
    return out;
  }, [config.codes, rates, primaryRate, title]);

  useBlockValuePublisher(instance.id, publishOutput);

  // ── XS — только курс primaryCode ──
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-1">
        <div
          className="truncate text-center text-sm font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {primaryRate ? formatRate(primaryRate.rateRub) : '—'}
        </div>
        <div className="truncate text-center text-[9px] text-muted-foreground">
          {config.primaryCode}/RUB
        </div>
      </Card>
    );
  }

  // ── SM — code + курс ──
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2">
        <div className="flex items-center gap-1">
          <Banknote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {config.primaryCode}/RUB
          </span>
        </div>
        <div
          className="mt-0.5 truncate text-lg font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {primaryRate ? formatRate(primaryRate.rateRub) : '—'}
        </div>
      </Card>
    );
  }

  // ── MD/LG — список валют ──
  return (
    <Card className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Banknote
            className="h-4 w-4 shrink-0 text-muted-foreground"
            style={accent ? { color: accent } : undefined}
          />
          <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            title={`Обновить курсы. Последнее обновление: ${formatLastUpdated(lastUpdatedAt)}`}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition',
              'hover:bg-accent hover:text-foreground',
              'disabled:opacity-40',
            )}
            aria-label="Обновить курсы"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-auto px-3 pb-3">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
        {visible.length === 0 && !loading ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            <div>
              <Banknote className="mx-auto mb-1 h-4 w-4" />
              {error
                ? 'Не удалось получить курсы'
                : 'Нет данных. Нажмите обновить или выберите валюты в настройках.'}
            </div>
          </div>
        ) : (
          visible.map((rate) => {
            const delta = deltaPercent(rate.rateRub, rate.previousRub);
            const isPrimary = rate.code === config.primaryCode;
            return (
              <div
                key={rate.code}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5',
                  isPrimary
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/40 bg-muted/20',
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                      isPrimary
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-foreground ring-1 ring-border/60',
                    )}
                  >
                    {rate.code}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {rate.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={isPrimary && accent ? { color: accent } : undefined}
                  >
                    {formatRate(rate.rateRub)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">₽</span>
                  {config.showDelta && delta !== null && (
                    <span
                      className={cn(
                        'flex items-center gap-0.5 text-[10px] tabular-nums',
                        delta > 0 && 'text-emerald-600 dark:text-emerald-400',
                        delta < 0 && 'text-red-600 dark:text-red-400',
                        delta === 0 && 'text-muted-foreground',
                      )}
                      title={`Вчера: ${rate.previousRub !== null ? formatRate(rate.previousRub) : '—'} ₽`}
                    >
                      {delta > 0 ? (
                        <TrendingUp className="h-2.5 w-2.5" />
                      ) : delta < 0 ? (
                        <TrendingDown className="h-2.5 w-2.5" />
                      ) : null}
                      {config.showPercent ? formatPercent(delta) : ''}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <footer className="shrink-0 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground">
        Источник: ЦБ РФ · обновлено {formatLastUpdated(lastUpdatedAt)}
      </footer>
    </Card>
  );
}

// ============================================================================
// Settings form
// ============================================================================

function CurrencyRatesSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = useMemo(() => parseConfig(config), [config]);
  const [allRatesDialogOpen, setAllRatesDialogOpen] = useState(false);
  const [allRates, setAllRates] = useState<CurrencyRate[] | null>(null);
  const [allRatesLoading, setAllRatesLoading] = useState(false);
  const [search, setSearch] = useState('');

  function patch(next: Partial<Config>) {
    onChange(serializeConfig({ ...parsed, ...next }));
  }

  function toggleCode(code: string) {
    const upper = code.toUpperCase();
    const has = parsed.codes.includes(upper);
    const nextCodes = has ? parsed.codes.filter((c) => c !== upper) : [...parsed.codes, upper];
    if (nextCodes.length === 0) return; // защита: должна остаться хотя бы одна
    const nextPrimary = nextCodes.includes(parsed.primaryCode)
      ? parsed.primaryCode
      : nextCodes[0];
    patch({ codes: nextCodes, primaryCode: nextPrimary });
  }

  async function openAllRates() {
    setAllRatesDialogOpen(true);
    if (allRates) return;
    setAllRatesLoading(true);
    try {
      const response = await fetch('/api/currency/rates', { cache: 'no-store' });
      const parsed = await parseJsonResponse(response);
      if (parsed.ok) {
        const data = parsed.data as { ok?: boolean; rates?: CurrencyRate[] };
        if (data.ok && Array.isArray(data.rates)) {
          setAllRates(data.rates);
        }
      }
      // При ошибке оставляем allRates=null — пользователь увидит «Нет данных»
      // в диалоге с подсказкой нажать обновить курсы из шапки блока.
    } finally {
      setAllRatesLoading(false);
    }
  }

  const otherRates = useMemo(() => {
    if (!allRates) return [];
    const popularCodes = new Set(POPULAR_CODES.map((p) => p.code));
    const q = search.trim().toLowerCase();
    return allRates
      .filter((r) => !popularCodes.has(r.code))
      .filter((r) => {
        if (!q) return true;
        return (
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [allRates, search]);

  return (
    <div className="space-y-4">
      {/* Популярные валюты */}
      <div className="space-y-2">
        <Label>Популярные валюты</Label>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {POPULAR_CODES.map((p) => {
            const active = parsed.codes.includes(p.code);
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => toggleCode(p.code)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition',
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 bg-background hover:bg-muted/40',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1',
                      active
                        ? 'bg-primary text-primary-foreground ring-primary'
                        : 'bg-background text-foreground ring-border/60',
                    )}
                  >
                    {p.code}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{p.label}</div>
                    {p.hint && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {p.hint}
                      </div>
                    )}
                  </div>
                </div>
                {active && (
                  <span className="shrink-0 text-[10px] text-primary">✓</span>
                )}
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs"
          onClick={openAllRates}
        >
          <ChevronDown className="h-3 w-3" /> Остальные валюты ЦБ
        </Button>
      </div>

      {/* Текущий список */}
      {parsed.codes.length > 0 && (
        <div className="space-y-1.5">
          <Label>Выбрано: {parsed.codes.length}</Label>
          <div className="flex flex-wrap gap-1">
            {parsed.codes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => toggleCode(code)}
                title="Убрать из списка"
                className="group inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-primary/30 transition hover:bg-primary/15"
              >
                {code}
                <X className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Основная валюта */}
      <div className="space-y-1.5">
        <Label>Основная валюта (для шапки и `value`)</Label>
        <select
          value={parsed.primaryCode}
          onChange={(e) => patch({ primaryCode: e.target.value })}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          {parsed.codes.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          В шапке блока показывается этот курс. Через `@блок.value` он доступен из
          формул. Также все выбранные валюты публикуются как `@блок.usd`,
          `@блок.eur`, ... и `@блок.usd_change` (Δ%).
        </p>
      </div>

      {/* Δ% настройки */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать Δ% от вчерашнего</div>
            <div className="text-[11px] text-muted-foreground">
              Стрелка ↑↓ + процент изменения
            </div>
          </div>
          <Switch
            checked={parsed.showDelta}
            onCheckedChange={(v) => patch({ showDelta: v })}
          />
        </div>
        {parsed.showDelta && (
          <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">Показывать процент</div>
              <div className="text-[11px] text-muted-foreground">
                Без процента — только стрелка вверх/вниз
              </div>
            </div>
            <Switch
              checked={parsed.showPercent}
              onCheckedChange={(v) => patch({ showPercent: v })}
            />
          </div>
        )}
      </div>

      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        Источник: <strong>ЦБ РФ</strong> через cbr-xml-daily.ru. Обновляется
        автоматически раз в сутки. Кнопка обновления в шапке блока — принудительный
        refresh (не чаще 1 раза в минуту).
      </div>

      {/* Диалог «остальные валюты» */}
      <Dialog open={allRatesDialogOpen} onOpenChange={setAllRatesDialogOpen}>
        <DialogContent className="w-[min(94vw,560px)] max-w-none gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border/60 px-4 py-3">
            <DialogTitle className="text-sm">Остальные валюты ЦБ РФ</DialogTitle>
            <DialogDescription className="text-[11px]">
              Все валюты из ежедневного отчёта ЦБ. Выберите нужные — они появятся в
              блоке.
            </DialogDescription>
          </DialogHeader>
          <div className="border-b border-border/40 px-3 py-2">
            <Input
              placeholder="Поиск по коду или названию..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {allRatesLoading ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Загружаю список валют…
              </p>
            ) : otherRates.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Нет данных. Возможно, нужно обновить курсы (кнопка в шапке блока).
              </p>
            ) : (
              <div className="space-y-1">
                {otherRates.map((rate) => {
                  const active = parsed.codes.includes(rate.code);
                  return (
                    <button
                      key={rate.code}
                      type="button"
                      onClick={() => toggleCode(rate.code)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition',
                        active
                          ? 'border-primary bg-primary/10'
                          : 'border-border/60 bg-background hover:bg-muted/40',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1',
                            active
                              ? 'bg-primary text-primary-foreground ring-primary'
                              : 'bg-background text-foreground ring-border/60',
                          )}
                        >
                          {rate.code}
                        </span>
                        <span className="truncate text-xs">{rate.name}</span>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatRate(rate.rateRub)} ₽
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Block definition
// ============================================================================

export const CurrencyRatesBlock: BlockDef = {
  type: 'currency.rates',
  displayName: 'Курсы валют',
  description:
    'Свежие курсы ЦБ РФ для выбранных валют. Курсы доступны в формулах через @блок.usd, @блок.eur и т.д. — для пересчёта цен и стоимости товара.',
  category: 'custom',
  icon: Banknote,
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 2 },
  pages: ['*'],
  configSchema: ConfigSchema,
  defaultConfig: () => ({
    codes: [...DEFAULT_CODES],
    primaryCode: DEFAULT_PRIMARY,
    showDelta: true,
    showPercent: true,
  }),
  supportsDependencies: false,
  SettingsForm: CurrencyRatesSettingsForm,
  Render: RenderCurrencyRates,
};
