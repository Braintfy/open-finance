// PURPOSE: Кнопки AI для page headers — «AI Анализ» (SectionAiDialog) +
// «Все блоки» (AnalyzeAllBlocksDialog: быстрый прогон по-блочного анализа).
// Добавляется в header разделов: cashflow, dashboard, inbox, marketplaces/ozon, unit-economics, boards.
'use client';

import { useState } from 'react';
import { Sparkles, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionAiDialog } from './section-ai-dialog';
import { AnalyzeAllBlocksDialog } from './analyze-all-blocks-dialog';

export type SectionAiButtonProps = {
  pageKey: string;
  /** Человекочитаемое название раздела (для заголовка диалога) */
  pageLabel?: string;
};

export function SectionAiButton({ pageKey, pageLabel }: SectionAiButtonProps) {
  const [open, setOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);

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

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setAllOpen(true)}
        title="Анализ всех блоков (быстрый прогон)"
      >
        <ListChecks className="h-4 w-4 text-primary" />
        <span className="hidden sm:inline">Все блоки</span>
      </Button>

      <SectionAiDialog
        open={open}
        onOpenChange={setOpen}
        pageKey={pageKey}
        pageLabel={pageLabel}
      />

      <AnalyzeAllBlocksDialog
        open={allOpen}
        onOpenChange={setAllOpen}
        pageKey={pageKey}
        pageLabel={pageLabel}
      />
    </>
  );
}
