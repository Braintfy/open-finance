// PURPOSE: Back-compat Dialog-обёртка над OzonSyncSettingsForm.
// Используется некоторыми legacy-toolbar'ами; новый Settings-tab блок-грид
// движка рендерит OzonSyncSettingsForm напрямую через BlockDef.SettingsForm.

'use client';

import { useEffect, useState } from 'react';
import { Plug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { OzonBlockSyncSettings } from './ozon-sync-diff';
import { OzonSyncSettingsForm } from './ozon-sync-settings-form';

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

  useEffect(() => {
    if (open) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

        <div className="max-h-[60vh] overflow-y-auto px-1">
          <OzonSyncSettingsForm
            value={draft}
            blockMode={blockMode}
            onChange={setDraft}
          />
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
          >
            Сохранить настройки
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
