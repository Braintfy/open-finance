// PURPOSE: Модалка «ИИ Микроагент» блока — shell с двумя режимами:
//  • «Анализ» (BlockAnalysisPanel) — точечный отчёт по блоку (резюме + инсайты,
//    история отчётов в БД, контекст из других блоков проекта);
//  • «Микроагент» (BlockMutatePanel) — ассистент мутации данных (заполнить/
//    структурировать/создать блок).
// По умолчанию открывается режим «Анализ».
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Sparkles, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockAnalysisPanel } from '@/components/blocks/block-analysis-panel';
import { BlockMutatePanel } from '@/components/blocks/block-mutate-panel';
import type { BlockContext, SuggestedAction } from '@/lib/ai/micro-agent/types';

type MicroAgentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockContext?: BlockContext;
  onApply?: (action: SuggestedAction) => void;
};

type Mode = 'analysis' | 'mutate';

export function MicroAgentDialog({
  open,
  onOpenChange,
  blockContext,
  onApply,
}: MicroAgentDialogProps) {
  const [mode, setMode] = useState<Mode>('analysis');

  // При каждом открытии — режим «Анализ» по умолчанию.
  useEffect(() => {
    if (open) setMode('analysis');
  }, [open]);

  const blockLabel = blockContext?.blockTitle ?? blockContext?.blockType;
  const canAnalyze = Boolean(blockContext?.pageKey && blockContext?.blockId);
  const activeMode: Mode = canAnalyze ? mode : 'mutate';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            ИИ Микроагент
            {blockLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                {blockLabel}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {activeMode === 'analysis'
              ? 'ИИ разберёт данные блока и составит отчёт с инсайтами.'
              : 'Загрузите данные, выберите действие — AI структурирует и предложит результат.'}
          </DialogDescription>

          {canAnalyze && (
            <div className="mt-2 inline-flex rounded-md border border-border/60 bg-muted/40 p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setMode('analysis')}
                className={cn(
                  'flex items-center gap-1 rounded px-2.5 py-1 transition-colors',
                  activeMode === 'analysis'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Sparkles className="h-3.5 w-3.5" /> Анализ
              </button>
              <button
                type="button"
                onClick={() => setMode('mutate')}
                className={cn(
                  'flex items-center gap-1 rounded px-2.5 py-1 transition-colors',
                  activeMode === 'mutate'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Wand2 className="h-3.5 w-3.5" /> Микроагент
              </button>
            </div>
          )}
        </DialogHeader>

        {activeMode === 'analysis' && canAnalyze ? (
          <BlockAnalysisPanel
            key={`analysis-${blockContext!.blockId!}`}
            open={open}
            pageKey={blockContext!.pageKey!}
            blockId={blockContext!.blockId!}
            blockType={blockContext?.blockType}
            blockTitle={blockContext?.blockTitle}
            blockData={blockContext?.blockData}
          />
        ) : (
          <BlockMutatePanel
            key={`mutate-${blockContext?.blockId ?? 'none'}`}
            open={open}
            blockContext={blockContext}
            onApply={onApply}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
