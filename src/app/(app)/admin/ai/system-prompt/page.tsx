// PURPOSE: Редактор кастомного system prompt tenant'а (используется во всех AI-вызовах)
'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Save, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

type State = {
  default: string;
  custom: string;
  usingDefault: boolean;
};

export default function SystemPromptPage() {
  const [data, setData] = useState<State | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/ai/system-prompt');
    const json = (await res.json()) as { ok: boolean } & State;
    if (json.ok) {
      setData({ default: json.default, custom: json.custom, usingDefault: json.usingDefault });
      setDraft(json.custom && json.custom.trim().length > 0 ? json.custom : json.default);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const isSameAsDefault = draft.trim() === data.default.trim();
      const res = await fetch('/api/admin/ai/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: isSameAsDefault ? '' : draft }),
      });
      const json = await res.json();
      if (json.ok) {
        setSavedAt(new Date().toLocaleTimeString('ru-RU'));
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  function resetToDefault() {
    if (!data) return;
    if (!confirm('Заменить текущий prompt на дефолтный? Изменения будут потеряны.')) return;
    setDraft(data.default);
  }

  const isDirty = data
    ? draft !== (data.custom && data.custom.trim().length > 0 ? data.custom : data.default)
    : false;

  const lines = draft.split('\n').length;
  const chars = draft.length;

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">AI System Prompt</h1>
          <p className="text-xs text-muted-foreground">
            Инструкция, которую AI получает перед каждым запросом (роль, правила, формат ответа)
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={resetToDefault} disabled={!data}>
            <RotateCcw /> К дефолту
          </Button>
          <Button size="sm" onClick={save} disabled={!isDirty || saving}>
            <Save /> {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </div>
      </div>

      {data && (
        <Alert>
          <Info />
          <AlertDescription className="text-xs">
            {data.usingDefault ? (
              <>
                Сейчас используется <strong>дефолтный prompt</strong>. Отредактируйте текст ниже
                и сохраните, чтобы применить свою версию ко всем AI-вызовам этого tenant'а.
              </>
            ) : (
              <>
                Используется <strong>ваша кастомная версия</strong>. Нажмите «К дефолту», чтобы
                вернуть стандартный prompt, а затем сохраните.
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Prompt
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {lines} стр. · {chars} симв.
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={24}
          spellCheck={false}
          className="w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed focus:outline-none"
          placeholder="Опишите роль AI, правила поведения, формат ответов…"
        />
      </div>

      {savedAt && (
        <p className="text-[11px] text-emerald-600">Сохранено в {savedAt}</p>
      )}

      <details className="rounded-lg border bg-muted/30 p-3 text-xs">
        <summary className="cursor-pointer font-medium">Подсказки по написанию prompt</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong>Структура:</strong> Роль → Контекст (страна, сфера) → Принципы → Формат
            ответов → Что НЕ делать
          </p>
          <p>
            <strong>Длина:</strong> 200-500 слов — оптимум для локальных моделей (qwen2.5:7b).
            Слишком длинный prompt снижает качество ответов и расходует контекстное окно.
          </p>
          <p>
            <strong>Примеры правил:</strong> «отвечай по-русски», «все суммы в рублях», «не
            давай юридических советов», «используй markdown-таблицы».
          </p>
          <p>
            <strong>Изменения вступают в силу сразу</strong> для новых диалогов. Активные чаты
            сохранят старый контекст до следующего сообщения.
          </p>
        </div>
      </details>
    </div>
  );
}
