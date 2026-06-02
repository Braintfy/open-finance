// PURPOSE: Панель «Микроагент» внутри модалки блока — ассистент мутации данных:
// принимает запрос/изображения/голос, стримит /api/ai/chat, предлагает действие
// (update_block / create_block / text_only) и применяет к блоку. Вынесено из
// прежнего micro-agent-dialog.tsx без изменения поведения.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Send,
  Loader2,
  Image as ImageIcon,
  Mic,
  MicOff,
  X,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Square,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QUICK_ACTIONS } from '@/lib/ai/micro-agent/types';
import type {
  BlockContext,
  QuickAction,
  MicroAgentResponse,
  SuggestedAction,
} from '@/lib/ai/micro-agent/types';

type BlockMutatePanelProps = {
  open: boolean;
  blockContext?: BlockContext;
  onApply?: (action: SuggestedAction) => void;
  onClose: () => void;
};

export function BlockMutatePanel({ open, blockContext, onApply, onClose }: BlockMutatePanelProps) {
  const [input, setInput] = useState('');
  const [blockPrompt, setBlockPrompt] = useState('');
  const [showBlockPrompt, setShowBlockPrompt] = useState(false);
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [finalStats, setFinalStats] = useState<{ tokensPerSec: number; totalTokens: number } | null>(null);
  const [response, setResponse] = useState<MicroAgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);

  // Сброс состояния при закрытии модалки.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setInput('');
      setImages([]);
      setResponse(null);
      setError(null);
      setSelectedAction(null);
      setStreaming(false);
      setStreamingContent('');
      setCurrentModel(null);
      setUsedFallback(false);
      setTokenCount(0);
      setElapsedSec(0);
      setFinalStats(null);
    }
  }, [open]);

  useEffect(() => {
    if (!streaming) return;
    const interval = setInterval(() => {
      setElapsedSec((Date.now() - startTimeRef.current) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [streaming]);

  const startRecording = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('Браузер не поддерживает распознавание речи');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognitionCtor() as any;
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript: string = event.results?.[0]?.[0]?.transcript ?? '';
      setInput((prev) => (prev ? prev + ' ' + transcript : transcript));
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        if (base64) setImages((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  async function handleSubmit() {
    if (!input.trim() && images.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    startTimeRef.current = Date.now();

    setStreaming(true);
    setStreamingContent('');
    setCurrentModel(null);
    setUsedFallback(false);
    setTokenCount(0);
    setElapsedSec(0);
    setFinalStats(null);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: input.trim(),
              ...(images.length > 0 ? { images } : {}),
            },
          ],
          blockContext: blockContext ?? undefined,
          quickAction: selectedAction ?? undefined,
          blockPrompt: blockContext?.aiPrompt?.trim() || blockPrompt.trim() || undefined,
        }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('x-ndjson')) {
        const data = await res.json().catch(() => ({ error: 'Неверный ответ сервера' }));
        setError(data.error ?? `Ошибка сервера (${res.status})`);
        setStreaming(false);
        return;
      }

      if (!res.body) {
        setError('Пустой ответ от сервера');
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as
              | { type: 'start'; model: string; fallback: boolean }
              | { type: 'token'; delta: string; total: number }
              | {
                  type: 'done';
                  content: string;
                  suggestedAction?: SuggestedAction;
                  model: string;
                  totalTokens: number;
                  durationSec: number;
                  tokensPerSec: number;
                }
              | { type: 'error'; error: string }
              | { type: 'aborted' };

            if (evt.type === 'start') {
              setCurrentModel(evt.model);
              setUsedFallback(evt.fallback);
            } else if (evt.type === 'token') {
              setStreamingContent((prev) => prev + evt.delta);
              setTokenCount(evt.total);
            } else if (evt.type === 'done') {
              setResponse({
                content: evt.content,
                suggestedAction: evt.suggestedAction,
                model: evt.model,
              });
              setFinalStats({ tokensPerSec: evt.tokensPerSec, totalTokens: evt.totalTokens });
              setStreaming(false);
            } else if (evt.type === 'error') {
              setError(evt.error);
              setStreaming(false);
            } else if (evt.type === 'aborted') {
              setStreaming(false);
            }
          } catch {
            /* битый chunk */
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setStreaming(false);
        return;
      }
      setError(e instanceof Error ? e.message : 'Network error');
      setStreaming(false);
    } finally {
      abortRef.current = null;
    }
  }

  function handleApply() {
    if (response?.suggestedAction && onApply) {
      onApply(response.suggestedAction);
      onClose();
    }
  }

  function handleRetry() {
    setResponse(null);
    setError(null);
  }

  const hasResult = response !== null;
  const canApply = response?.suggestedAction && response.suggestedAction.type !== 'text_only';
  const liveTokensPerSec = elapsedSec > 0 ? tokenCount / elapsedSec : 0;

  return (
    <>
      <div className="flex flex-col gap-3 p-5">
        {/* Block prompt (collapsible) */}
        <div>
          <button
            type="button"
            onClick={() => setShowBlockPrompt((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showBlockPrompt ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Инструкция для блока
          </button>
          {showBlockPrompt && (
            <textarea
              value={blockPrompt}
              onChange={(e) => setBlockPrompt(e.target.value)}
              placeholder="Дополнительная инструкция для AI (необязательно)..."
              rows={2}
              className="mt-1.5 w-full resize-none rounded-md border bg-muted/30 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setSelectedAction(selectedAction === action.id ? null : action.id)}
              className={
                'h-7 rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (selectedAction === action.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground')
              }
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Image attachments */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="group/img relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${img}`}
                  alt={`Attachment ${idx + 1}`}
                  className="h-16 w-16 rounded-md border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition group-hover/img:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        {!hasResult && !streaming && (
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Опишите что нужно сделать, вставьте текст/данные..."
              rows={4}
              disabled={streaming}
              className="w-full resize-none rounded-md border bg-background px-3 py-2.5 pr-24 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <div className="absolute bottom-2 right-2 flex gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Прикрепить изображение"
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                title={isRecording ? 'Остановить запись' : 'Голосовой ввод'}
                className={isRecording ? 'text-red-500' : ''}
              >
                {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Live streaming preview */}
        {streaming && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {currentModel ? (
                <>
                  AI пишет через <span className="font-medium text-foreground">{currentModel}</span>
                  {usedFallback && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                      fallback
                    </span>
                  )}
                </>
              ) : (
                'Подключение к Ollama...'
              )}
            </div>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
              {streamingContent || <span className="text-muted-foreground italic">Ожидание ответа...</span>}
              {streamingContent && <span className="inline-block h-3 w-1 animate-pulse bg-foreground" />}
            </div>
          </div>
        )}

        {/* Response preview */}
        {hasResult && response && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Ответ от <span className="font-medium text-foreground">{response.model}</span>
              {response.suggestedAction && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {response.suggestedAction.type === 'update_block' && 'Обновить блок'}
                  {response.suggestedAction.type === 'create_block' && 'Создать блок'}
                  {response.suggestedAction.type === 'text_only' && 'Текст'}
                </span>
              )}
              {finalStats && (
                <span className="ml-auto flex items-center gap-1 font-mono">
                  <Zap className="h-3 w-3" />
                  {finalStats.totalTokens} токенов · {finalStats.tokensPerSec.toFixed(1)} т/с
                </span>
              )}
            </div>
            <div className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
              {response.content.replace(/```json[\s\S]*?```/g, '').trim()}
            </div>
            {response.suggestedAction && response.suggestedAction.type !== 'text_only' && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                  Предложенные данные (JSON)
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-[11px]">
                  {JSON.stringify(response.suggestedAction.payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-[11px] text-muted-foreground">
          {streaming ? (
            <span className="flex items-center gap-3 font-mono">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {tokenCount} токенов
              </span>
              <span>{liveTokensPerSec.toFixed(1)} т/с</span>
              <span>{elapsedSec.toFixed(1)}с</span>
            </span>
          ) : (
            <>
              {!hasResult && '⌘/Ctrl+Enter — отправить'}
              {hasResult && canApply && 'Проверьте результат и примените'}
            </>
          )}
        </div>
        <div className="flex gap-1.5">
          {streaming && (
            <Button variant="destructive" size="sm" onClick={handleStop}>
              <Square className="h-3.5 w-3.5" /> Остановить
            </Button>
          )}
          {!streaming && !hasResult && (
            <Button size="sm" onClick={handleSubmit} disabled={!input.trim() && images.length === 0}>
              <Send className="h-3.5 w-3.5" />
              Отправить
            </Button>
          )}
          {!streaming && hasResult && (
            <>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RotateCcw className="h-3.5 w-3.5" /> Переделать
              </Button>
              {canApply && (
                <Button size="sm" onClick={handleApply}>
                  <Check className="h-3.5 w-3.5" /> Применить
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
