// PURPOSE: Обёртка вокруг блока — drag handle + кнопки настроек/удалить.
// Notion-style: контролы появляются при hover (с задержкой ~250мс), в edit mode — видны всегда.
'use client';

import { GripVertical, X, Settings2, Network } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { BlockAppearance, BlockInstance } from '@/lib/blocks/types';
import { CrossPagePin } from './cross-page-pin';

/** Задержка появления hover-контролов в обычном режиме (Notion = 0мс, мы ставим лёгкую задержку чтобы избежать мигания) */
const HOVER_REVEAL_DELAY_MS = 250;

export function BlockChrome({
  children,
  editMode,
  appearance,
  block,
  currentPageKey,
  hasRelations,
  onRemove,
  onOpenSettings,
}: {
  children: ReactNode;
  editMode: boolean;
  appearance?: BlockAppearance;
  /** Блок целиком (для CrossPagePin — нужны dependencies) */
  block?: BlockInstance;
  /** Ключ текущей страницы — для определения cross-page связей */
  currentPageKey?: string;
  /** Блок участвует в связях (source или target) — показать микро-иконку */
  hasRelations?: boolean;
  onRemove?: () => void;
  onOpenSettings?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  function handleEnter() {
    if (editMode) return; // в edit mode контролы всегда видны
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), HOVER_REVEAL_DELAY_MS);
  }

  function handleLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHovered(false);
  }

  // Контролы видны в edit mode или при hover после задержки
  const showControls = editMode || hovered;

  // CSS variables — читаются внутри блоков через var(--block-accent)
  const cssVars: CSSProperties & Record<string, string> = {};
  if (appearance?.accentColor) cssVars['--block-accent'] = appearance.accentColor;
  if (appearance?.borderColor) cssVars['--block-border'] = appearance.borderColor;

  const wrapperStyle: CSSProperties = {
    ...cssVars,
    ...(appearance?.borderColor
      ? {
          boxShadow: `inset 0 0 0 2px ${appearance.borderColor}`,
          borderRadius: '0.5rem',
        }
      : {}),
  };

  return (
    <div
      className="group group/block relative h-full w-full"
      style={wrapperStyle}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Drag handle — сверху по центру. Работает при hover (Notion-style) и в edit mode. */}
      <div
        className={
          'block-drag-handle absolute left-1/2 top-1 z-30 -translate-x-1/2 rounded bg-background/95 px-2 py-0.5 shadow-sm ring-1 ring-border transition-opacity duration-150 ' +
          (showControls
            ? 'cursor-move pointer-events-auto opacity-100 '
            : 'pointer-events-none opacity-0 ')
        }
        title="Перетащить блок"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {/* Cross-page pin — мини-индикатор связей с другими страницами */}
      {block && currentPageKey && (
        <CrossPagePin block={block} currentPageKey={currentPageKey} />
      )}

      {/* Action toolbar справа-сверху */}
      <div
        className={
          'absolute right-1 top-1 z-30 flex gap-1 transition-opacity duration-150 ' +
          (showControls ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
      >
        {onOpenSettings && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full bg-background/95 shadow-sm ring-1 ring-border hover:bg-accent"
            onClick={onOpenSettings}
            aria-label="Настройки блока"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {editMode && onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full bg-background/95 text-red-600 shadow-sm ring-1 ring-border hover:bg-red-50"
            onClick={onRemove}
            aria-label="Удалить блок"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Micro-icon: блок участвует в связях */}
      {hasRelations && (
        <div
          className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-sm opacity-20 transition-opacity group-hover/block:opacity-35"
          title="Блок связан с другими"
        >
          <Network className="h-3 w-3 text-indigo-500" />
        </div>
      )}

      {/* Само содержимое блока. В edit mode — рамка + приглушённость + блокировка кликов */}
      <div
        className={
          editMode
            ? 'pointer-events-none h-full w-full rounded-lg opacity-90 ring-2 ring-dashed ring-primary/30'
            : 'h-full w-full'
        }
      >
        {children}
      </div>
    </div>
  );
}
