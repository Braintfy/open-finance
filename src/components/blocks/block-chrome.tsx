// PURPOSE: Обёртка вокруг блока — drag handle, кнопка удалить (только в edit mode)
'use client';

import { GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

export function BlockChrome({
  children,
  editMode,
  onRemove,
}: {
  children: ReactNode;
  editMode: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className="relative h-full w-full">
      {editMode && (
        <>
          <div
            className="block-drag-handle absolute left-1/2 top-1 z-20 -translate-x-1/2 cursor-move rounded bg-background/90 px-2 py-0.5 shadow-sm ring-1 ring-border"
            title="Перетащить"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 z-20 h-7 w-7 rounded-full bg-background/90 text-red-600 shadow-sm ring-1 ring-border hover:bg-red-50"
              onClick={onRemove}
              aria-label="Удалить блок"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </>
      )}
      <div
        className={
          editMode
            ? 'pointer-events-none h-full w-full opacity-90 ring-2 ring-dashed ring-primary/30 rounded-lg'
            : 'h-full w-full'
        }
      >
        {children}
      </div>
    </div>
  );
}
