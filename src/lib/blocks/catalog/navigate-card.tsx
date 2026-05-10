// PURPOSE: Блок-карточка навигации (ссылка на раздел с иконкой, описанием, состоянием "скоро")
'use client';

import Link from 'next/link';
import { LinkIcon } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resolveIcon } from '../icon-resolver';
import { cn } from '@/lib/utils';
import { useBlockDensity } from '@/components/blocks/block-size';

const NavCardConfig = z.object({
  href: z.string().default('/dashboard'),
  title: z.string().default('Раздел'),
  description: z.string().default(''),
  comingSoon: z.boolean().default(false),
});

function RenderNavCard({ instance }: BlockRenderProps) {
  const cfg = NavCardConfig.parse(instance.config ?? {});
  const Icon = resolveIcon(instance.appearance?.icon, LinkIcon);
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? cfg.title;
  const density = useBlockDensity();

  const iconBg = accent ? { backgroundColor: `${accent}15`, color: accent } : undefined;

  let inner: React.ReactNode;

  if (density === 'xs') {
    // Только иконка центрирована
    inner = (
      <Card
        className={cn(
          'flex h-full items-center justify-center p-1 transition-colors',
          cfg.comingSoon ? 'opacity-60' : 'cursor-pointer hover:bg-accent/30'
        )}
        title={title}
      >
        <div
          className="flex h-6 w-6 items-center justify-center rounded bg-muted"
          style={iconBg}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </Card>
    );
  } else if (density === 'sm') {
    // Иконка + title без description
    inner = (
      <Card
        className={cn(
          'flex h-full flex-col justify-center p-2 transition-colors',
          cfg.comingSoon ? 'opacity-60' : 'cursor-pointer hover:bg-accent/30'
        )}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted"
            style={iconBg}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold">{title}</div>
            {cfg.comingSoon && <div className="text-[9px] text-muted-foreground">скоро</div>}
          </div>
        </div>
      </Card>
    );
  } else {
    // Полный MD/LG
    inner = (
      <Card
        className={cn(
          'flex h-full flex-col transition-colors',
          cfg.comingSoon ? 'opacity-60' : 'cursor-pointer hover:bg-accent/30'
        )}
      >
        <CardHeader className="pb-1.5">
          <div className="flex items-start justify-between gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md bg-muted"
              style={iconBg}
            >
              <Icon className="h-4 w-4" />
            </div>
            {cfg.comingSoon && (
              <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground ring-1 ring-inset ring-border">
                скоро
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          {cfg.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {cfg.description}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (cfg.comingSoon) return inner;
  return (
    <Link href={cfg.href} className="block h-full">
      {inner}
    </Link>
  );
}

function NavCardSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = NavCardConfig.parse(config ?? {});
  function set<K extends keyof typeof cfg>(key: K, value: (typeof cfg)[K]) {
    onChange({ ...cfg, [key]: value });
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="nav-title">Заголовок</Label>
        <Input
          id="nav-title"
          value={cfg.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Денежный поток"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nav-desc">Описание</Label>
        <Input
          id="nav-desc"
          value={cfg.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Краткое описание раздела"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nav-href">URL</Label>
        <Input
          id="nav-href"
          value={cfg.href}
          onChange={(e) => set('href', e.target.value)}
          placeholder="/cashflow"
        />
        <p className="text-[11px] text-muted-foreground">
          Начните с <code>/</code> для внутреннего раздела, например <code>/cashflow</code>
        </p>
      </div>
      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <div className="text-sm font-medium">Статус «скоро»</div>
          <div className="text-[11px] text-muted-foreground">
            Карточка станет неактивной (пригодится для будущих разделов)
          </div>
        </div>
        <input
          type="checkbox"
          checked={cfg.comingSoon}
          onChange={(e) => set('comingSoon', e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
      </div>
    </div>
  );
}

export const NavigateCardBlock: BlockDef = {
  type: 'navigate.card',
  displayName: 'Карточка раздела',
  description: 'Кликабельная карточка-ссылка на раздел с иконкой, заголовком и описанием',
  category: 'custom',
  icon: LinkIcon,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 60, h: 40 },
  pages: ['dashboard', '*'],
  configSchema: NavCardConfig,
  defaultConfig: () => ({
    href: '/cashflow',
    title: 'Раздел',
    description: 'Описание раздела',
    comingSoon: false,
  }),
  SettingsForm: NavCardSettings,
  Render: RenderNavCard,
};
