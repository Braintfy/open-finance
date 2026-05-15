// PURPOSE: Блок AI Micro-Agent (ai.micro-agent) — встроенный AI-ассистент внутри Block-Grid.
// Пользователь вводит запрос прямо в блоке, AI возвращает структурированный результат.
'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBlockDensity } from '@/components/blocks/block-size';
import { QUICK_ACTIONS } from '@/lib/ai/micro-agent/types';
import type { QuickAction, MicroAgentResponse } from '@/lib/ai/micro-agent/types';

// ============================================================================
// Config
// ============================================================================

const ConfigSchema = z.object({
  /** Кастомный промпт для этого блока */
  blockPrompt: z.string().default(''),
  /** Предпочтительная модель */
  model: z.string().default(''),
  /** Последний результат (для отображения) */
  lastResult: z.string().optional(),
  /** Последний action type */
  lastActionType: z.string().optional(),
});
type Config = z.infer<typeof ConfigSchema>;

function parseConfig(raw: unknown): Config {
  const r = ConfigSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  return { blockPrompt: '', model: '', lastResult: undefined, lastActionType: undefined };
}

// ============================================================================
// Render
// ============================================================================

function RenderMicroAgent({ instance, onConfigChange }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? 'AI Микроагент';

  const [input, setInput] = useState('');
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<MicroAgentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: input.trim() }],
          quickAction: selectedAction ?? undefined,
          // Master-промпт (instance.aiPrompt) > legacy config.blockPrompt
          blockPrompt: instance.aiPrompt || config.blockPrompt || undefined,
          model: config.model || undefined,
        }),
      });

      // Если сервер вернул JSON ошибки (auth / resolve) — обработать
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('x-ndjson')) {
        const data = await res.json().catch(() => ({ error: 'Неверный ответ сервера' }));
        setError(data.error ?? `Ошибка (${res.status})`);
        return;
      }

      if (!res.body) {
        setError('Пустой ответ от сервера');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResp: MicroAgentResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as {
              type: string;
              content?: string;
              suggestedAction?: MicroAgentResponse['suggestedAction'];
              model?: string;
              error?: string;
            };
            if (evt.type === 'done' && evt.content) {
              finalResp = {
                content: evt.content,
                suggestedAction: evt.suggestedAction,
                model: evt.model ?? '',
              };
            } else if (evt.type === 'error') {
              setError(evt.error ?? 'Ошибка AI');
            }
          } catch {
            // битый chunk
          }
        }
      }

      if (finalResp) {
        setResponse(finalResp);
        onConfigChange?.({
          ...config,
          lastResult: finalResp.content.replace(/```json[\s\S]*?```/g, '').trim().slice(0, 500),
          lastActionType: finalResp.suggestedAction?.type ?? 'text_only',
        } as unknown as Record<string, unknown>);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  }

  // XS — только иконка
  if (density === 'xs') {
    return (
      <Card className="flex h-full items-center justify-center p-1">
        <Sparkles className="h-4 w-4" style={accent ? { color: accent } : undefined} />
      </Card>
    );
  }

  // SM — иконка + название
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0" style={accent ? { color: accent } : undefined} />
          <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
        {config.lastResult && (
          <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{config.lastResult}</p>
        )}
      </Card>
    );
  }

  // MD/LG — полный интерфейс
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" style={accent ? { color: accent } : undefined} />
          <span className="line-clamp-1">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-y-auto pb-3 pt-1">
        {/* Quick actions */}
        <div className="flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => setSelectedAction(selectedAction === action.id ? null : action.id)}
              className={
                'h-6 rounded px-2 text-[10px] font-medium transition-colors ' +
                (selectedAction === action.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {action.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-1">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Что нужно сделать..."
            disabled={loading}
            className="h-8 flex-1 text-xs"
          />
          <Button
            size="icon-sm"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Response */}
        {response && (
          <div className="flex-1 overflow-y-auto rounded border bg-muted/20 p-2">
            <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Sparkles className="h-2.5 w-2.5" />
              {response.model}
              {response.suggestedAction && (
                <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                  {response.suggestedAction.type === 'update_block' && 'Обновить'}
                  {response.suggestedAction.type === 'create_block' && 'Создать'}
                  {response.suggestedAction.type === 'text_only' && 'Текст'}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed">
              {response.content.replace(/```json[\s\S]*?```/g, '').trim()}
            </p>
          </div>
        )}

        {/* Last result (when no active response) */}
        {!response && config.lastResult && (
          <div className="flex-1 overflow-y-auto rounded border border-dashed border-border/60 bg-muted/10 p-2">
            <p className="text-[11px] text-muted-foreground">{config.lastResult}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Settings
// ============================================================================

function MicroAgentSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Модель (опционально)</Label>
        <Input
          value={parsed.model}
          onChange={(e) => onChange({ ...parsed, model: e.target.value })}
          placeholder="qwen2.5:7b (по умолчанию)"
          className="h-8 text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Ollama-тег модели. Оставьте пустым для использования модели по умолчанию.
        </p>
      </div>

      <div className="rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
        Master-промпт ассистента редактируется во вкладке <strong>«AI / Промпт»</strong>{' '}
        (доступна для любого блока). Поле <code className="rounded bg-muted px-1">config.blockPrompt</code>{' '}
        оставлено для обратной совместимости и используется если master-промпт пуст.
      </div>
    </div>
  );
}

// ============================================================================
// Block Definition
// ============================================================================

export const AiMicroAgentBlock: BlockDef = {
  type: 'ai.micro-agent',
  displayName: 'AI Микроагент',
  description: 'Встроенный AI-ассистент для быстрого создания и заполнения блоков из разнородных данных.',
  category: 'custom',
  icon: Sparkles,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 200, h: 120 },
  pages: ['*'],
  configSchema: ConfigSchema,
  defaultConfig: () => ({ blockPrompt: '', model: '', lastResult: undefined, lastActionType: undefined }),
  SettingsForm: MicroAgentSettingsForm,
  Render: RenderMicroAgent,
};
