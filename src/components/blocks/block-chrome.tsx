// PURPOSE: Обёртка вокруг блока — drag handle, кнопки настроек/удалить (только в edit mode)
'use client';

import { GripVertical, X, Settings2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { BlockAppearance } from '@/lib/blocks/types';

export function BlockChrome({
  children,
  editMode,
  appearance,
  onRemove,
  onOpenSettings,
}: {
  children: ReactNode;
  editMode: boolean;
  appearance?: BlockAppearance;
  onRemove?: () => void;
  onOpenSettings?: () => void;
}) {
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
    <div className="relative h-full w-full" style={wrapperStyle}>
      {editMode && (
        <>
          <div
            className="block-drag-handle absolute left-1/2 top-1 z-30 -translate-x-1/2 cursor-move rounded bg-background/95 px-2 py-0.5 shadow-sm ring-1 ring-border"
            title="Перетащить"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="absolute right-1 top-1 z-30 flex gap-1">
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
            {onRemove && (
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
        </>
      )}
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
