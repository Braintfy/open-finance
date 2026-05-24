// PURPOSE: Обёртка вокруг блока — drag handle + кнопки настроек/удалить.
// Notion-style: контролы появляются при hover (с задержкой ~250мс), в edit mode — видны всегда.
'use client';

import { GripVertical, X, Settings2, Network, Sparkles } from 'lucide-react';
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
  onOpenAi,
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
  /** Открыть AI микроагент в контексте этого блока */
  onOpenAi?: () => void;
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

  return (
    <div
      className="group group/block relative h-full w-full"
      style={cssVars}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/*
        Border-overlay: рисует цветную рамку поверх детей блока.
        Использовать inset boxShadow на wrapper'е нельзя — у большинства блоков
        внутренний контейнер с `bg-card` и `border` рисуется на всю площадь и
        прячет inset-shadow родителя. Полупрозрачный fill + outer ring дают
        видимый акцент на любом фоне (light/dark + кастомные bg).
      */}
      {appearance?.borderColor && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 rounded-lg"
          style={{
            boxShadow: `inset 0 0 0 2px ${appearance.borderColor}`,
          }}
        />
      )}
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

      {/*
        Action toolbar справа-сверху (v0.23.3).
        Видимость управляется CSS из `block-grid.css` — зеркальный паттерн
        с resize-handle. Триггеры:
          1. Edit mode (`.react-grid-item.block-edit-mode`).
          2. Курсор над hot-zone в правом верхнем углу (`[data-toolbar-hotzone]`).
          3. Курсор над самой панелью (`.block-toolbar:hover`) — не моргает.
        Класс `block-toolbar` опознаётся CSS-правилом. Без `showControls`-JS-
        стейта: один источник правды — CSS. Делает поведение идентичным ресайзу.
      */}
      <div
        className="block-toolbar absolute right-1 top-1 z-30 flex gap-1"
      >
        {onOpenAi && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full bg-background/95 shadow-sm ring-1 ring-border hover:bg-accent text-primary"
            onClick={onOpenAi}
            aria-label="AI Микроагент"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </Button>
        )}
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

      {/*
        Toolbar hot-zone (v0.23.3): невидимая 40×72 область в правом верхнем углу.
        Зеркало resize-hotzone — служит триггером CSS `:has([data-toolbar-hotzone]:hover)`
        для показа `.block-toolbar`. Не блокирует клики по самому toolbar (там
        `block-toolbar` имеет более высокий z-index 30 vs 15 у hotzone).
      */}
      <div
        data-toolbar-hotzone
        aria-hidden
        className="pointer-events-auto absolute right-0 top-0 z-[15] h-10 w-20"
      />

      {/* Micro-icon: блок участвует в связях */}
      {hasRelations && (
        <div
          className="absolute bottom-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-sm opacity-20 transition-opacity group-hover/block:opacity-35"
          title="Блок связан с другими"
        >
          <Network className="h-3 w-3 text-indigo-500" />
        </div>
      )}

      {/*
        Resize hot-zone: невидимая 40×40 область в правом нижнем углу.
        Сам по себе ничего не делает — служит триггером для CSS-правил
        в block-grid.css (`:has([data-resize-hotzone]:hover)`),
        которые показывают react-resizable-handle.
        Данные подсказки наведения проксируем сюда через cursor-se-resize.
        В view mode (не edit) и без относительной позиции родителя — не мешает.
      */}
      <div
        data-resize-hotzone
        aria-hidden
        className="pointer-events-auto absolute bottom-0 right-0 z-20 h-10 w-10 cursor-se-resize"
      />

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
