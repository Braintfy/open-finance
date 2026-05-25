// PURPOSE: Диалог «AI Анализ раздела» — собирает блоки страницы и стримит AI-анализ.
// Поддерживает scope: 'all' (все блоки) | 'subgraph' (только связанные).
'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Square, RefreshCw, Loader2 } from 'lucide-react';

type SectionAiScope = 'all' | 'subgraph';

type SectionAiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageKey: string;
  pageLabel?: string;
};

type StreamEvent =
  | { type: 'start'; model?: string }
  | { type: 'token'; delta: string }
  | { type: 'done'; content: string }
  | { type: 'error'; error: string }
  | { type: 'aborted' };

export function SectionAiDialog({
  open,
  onOpenChange,
  pageKey,
  pageLabel,
}: SectionAiDialogProps) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SectionAiScope>('all');
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const analyze = useCallback(async () => {
    if (streaming) { stop(); return; }

    setStreaming(true);
    setResult('');
    setError(null);
    setModel(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ai/analyze-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey,
          scope,
          userQuery: query.trim() || undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed) as StreamEvent;
            if (evt.type === 'start' && evt.model) setModel(evt.model);
            if (evt.type === 'token' && evt.delta) {
              setResult((prev) => {
                const next = prev + evt.delta;
                // Scroll to bottom
                requestAnimationFrame(() => {
                  resultRef.current?.scrollTo({ top: resultRef.current.scrollHeight, behavior: 'smooth' });
                });
                return next;
              });
            }
            if (evt.type === 'done') {
              setStreaming(false);
            }
            if (evt.type === 'error') {
              setError(evt.error);
              setStreaming(false);
            }
            if (evt.type === 'aborted') {
              setStreaming(false);
            }
          } catch {
            // Пропускаем не-JSON строки
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
      }
      setStreaming(false);
    }
  }, [streaming, stop, pageKey, scope, query]);

  function handleClose(v: boolean) {
    if (!v && streaming) stop();
    onOpenChange(v);
  }

  const hasResult = result.length > 0;
  const sectionTitle = pageLabel ?? pageKey;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Анализ · {sectionTitle}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            AI проанализирует блоки этого раздела и ответит на ваш вопрос
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-y-auto p-4">
          {/* Scope toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Контекст:</span>
            <div className="flex rounded-md border text-[11px]">
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`px-2.5 py-1 transition-colors ${scope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Все блоки
              </button>
              <button
                type="button"
                onClick={() => setScope('subgraph')}
                className={`border-l px-2.5 py-1 transition-colors ${scope === 'subgraph' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Только связанные
              </button>
            </div>
          </div>

          {/* Query textarea */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Вопрос (необязательно)
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={2}
              placeholder="Что анализировать? Оставьте пустым для общего анализа раздела…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={streaming}
            />
          </div>

          {/* Result */}
          {(hasResult || error) && (
            <div
              ref={resultRef}
              className="min-h-[100px] max-h-[320px] overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm leading-relaxed"
            >
              {error ? (
                <p className="text-destructive text-xs">{error}</p>
              ) : (
                <div className="whitespace-pre-wrap font-sans text-[13px]">
                  {result}
                  {streaming && (
                    <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-foreground opacity-70 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {model && !streaming && hasResult && (
            <p className="text-[10px] text-muted-foreground">Модель: {model}</p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            {streaming && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Анализирую…
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {hasResult && !streaming && (
              <Button variant="ghost" size="sm" onClick={() => { setResult(''); setError(null); }}>
                <RefreshCw className="h-3.5 w-3.5" />
                Очистить
              </Button>
            )}
            <Button
              size="sm"
              variant={streaming ? 'destructive' : 'default'}
              onClick={analyze}
            >
              {streaming ? (
                <><Square className="h-3.5 w-3.5" /> Стоп</>
              ) : (
                <><Sparkles className="h-3.5 w-3.5" /> {hasResult ? 'Обновить' : 'Анализировать'}</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
