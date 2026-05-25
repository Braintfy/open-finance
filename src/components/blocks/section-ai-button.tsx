// PURPOSE: Кнопка «AI Анализ» для page headers — открывает SectionAiDialog.
// Добавляется в header разделов: cashflow, dashboard, inbox, marketplaces/ozon, unit-economics, boards.
'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionAiDialog } from './section-ai-dialog';

export type SectionAiButtonProps = {
  pageKey: string;
  /** Человекочитаемое название раздела (для заголовка диалога) */
  pageLabel?: string;
};

export function SectionAiButton({ pageKey, pageLabel }: SectionAiButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        title="AI Анализ раздела"
      >
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="hidden sm:inline">AI Анализ</span>
      </Button>

      <SectionAiDialog
        open={open}
        onOpenChange={setOpen}
        pageKey={pageKey}
        pageLabel={pageLabel}
      />
    </>
  );
}
