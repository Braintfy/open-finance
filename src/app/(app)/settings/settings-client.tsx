// PURPOSE: Клиентский UI настроек — видимость разделов навигации
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  LayoutGrid,
  Inbox,
  Wallet,
  Calendar,
  Settings as SettingsIcon,
  Shield,
  Cpu,
  Sparkles,
  Users,
  Wrench,
  Eye,
  EyeOff,
  Save,
  Coins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useFormatSettings } from '@/lib/format-settings';

type NavItem = {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  protected?: boolean; // нельзя скрыть
  adminOnly?: boolean;
};

const MAIN_NAV: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Дашборд',
    description: 'Главная страница с KPI',
    icon: LayoutDashboard,
    protected: true,
  },
  {
    key: 'inbox',
    label: 'Inbox',
    description: 'Чеки, счета, документы',
    icon: Inbox,
  },
  {
    key: 'cashflow',
    label: 'Денежный поток',
    description: 'Доходы, расходы, импорт выписок',
    icon: Wallet,
  },
  {
    key: 'boards',
    label: 'Мои доски',
    description: 'Персональные рабочие пространства',
    icon: LayoutGrid,
  },
  {
    key: 'deadlines',
    label: 'Дедлайны',
    description: 'Налоги, отчёты, обязательства',
    icon: Calendar,
  },
  {
    key: 'settings',
    label: 'Настройки',
    description: 'Эта страница (всегда видна)',
    icon: SettingsIcon,
    protected: true,
  },
];

const ADMIN_NAV: NavItem[] = [
  { key: 'admin', label: 'Панель админа', description: 'Управление tenant', icon: Shield, adminOnly: true },
  { key: 'admin-ai-models', label: 'AI модели', description: 'Ollama', icon: Cpu, adminOnly: true },
  { key: 'admin-ai-prompt', label: 'AI prompt', description: 'System prompt', icon: Sparkles, adminOnly: true },
  { key: 'admin-users', label: 'Пользователи', description: 'Управление users', icon: Users, adminOnly: true },
  { key: 'admin-settings', label: 'Настройки платформы', description: 'Tenant settings', icon: Wrench, adminOnly: true },
];

export function SettingsClient({
  initialHidden,
  isAdmin,
}: {
  initialHidden: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialHidden));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function toggle(key: string, isProtected?: boolean) {
    if (isProtected) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSavedAt(null);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/blocks/layout/nav', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [],
          hiddenSections: Array.from(hidden),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedAt(new Date().toLocaleTimeString('ru-RU'));
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const isDirty =
    Array.from(hidden).sort().join(',') !== initialHidden.slice().sort().join(',');

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Настройки</h1>
          <p className="text-xs text-muted-foreground">Видимость разделов навигации</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={save} disabled={!isDirty || saving}>
            <Save /> {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      </div>

      {savedAt && (
        <Alert>
          <AlertDescription className="text-xs">
            ✓ Изменения применены в {savedAt}. Боковая панель обновится при следующем переходе.
          </AlertDescription>
        </Alert>
      )}

      <section>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Основные разделы
        </div>
        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-card">
          {MAIN_NAV.map((item) => (
            <NavRow
              key={item.key}
              item={item}
              isHidden={hidden.has(item.key)}
              onToggle={() => toggle(item.key, item.protected)}
            />
          ))}
        </div>
      </section>

      {isAdmin && (
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Админ-разделы
          </div>
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-card">
            {ADMIN_NAV.map((item) => (
              <NavRow
                key={item.key}
                item={item}
                isHidden={hidden.has(item.key)}
                onToggle={() => toggle(item.key)}
              />
            ))}
          </div>
        </section>
      )}

      <Alert className="text-xs">
        <AlertDescription>
          Скрытые разделы остаются доступны по прямой ссылке — это только настройка отображения в
          боковой панели.
        </AlertDescription>
      </Alert>

      <FormatSection />
    </div>
  );
}

function NavRow({
  item,
  isHidden,
  onToggle,
}: {
  item: NavItem;
  isHidden: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={item.protected}
      className={
        item.protected
          ? 'flex w-full items-center gap-3 px-3 py-2.5 text-left opacity-60'
          : 'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40'
      }
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{item.label}</span>
          {item.protected && (
            <span className="inline-flex h-4 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              всегда
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{item.description}</div>
      </div>
      <div className="shrink-0">
        {isHidden ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">
            <EyeOff className="h-3 w-3" /> скрыт
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-50 px-2 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-800">
            <Eye className="h-3 w-3" /> виден
          </span>
        )}
      </div>
    </button>
  );
}

function FormatSection() {
  const { settings, update } = useFormatSettings();

  return (
    <section>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Формат отображения
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => update({ showKopecks: !settings.showKopecks })}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
        >
          <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Показывать копейки</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Дробная часть сумм: 1 234,56 ₽ вместо 1 235 ₽
            </div>
          </div>
          <div className="shrink-0">
            <div
              className={
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ' +
                (settings.showKopecks ? 'bg-primary' : 'bg-muted')
              }
            >
              <span
                className={
                  'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ' +
                  (settings.showKopecks ? 'translate-x-[18px]' : 'translate-x-0.5')
                }
              />
            </div>
          </div>
        </button>
      </div>
    </section>
  );
}
