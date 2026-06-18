// PURPOSE: Редактор AI промптов — глобальный + разделы + блоки + точечные (4 tabs).
'use client';

import { useEffect, useState, useCallback } from 'react';
import { RotateCcw, Save, Info, Loader2, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

// =====================================================================
// Типы
// =====================================================================

type PromptTab = 'global' | 'sections' | 'blocks' | 'pointwise';

type SectionGroupData = {
  id: string;
  label: string;
  description: string;
  default: string;
  custom: string;
};

type BlockData = {
  type: string;
  displayName: string;
  default: string;
  custom: string;
};

// =====================================================================
// Shared: PromptEditor
// =====================================================================

function PromptEditor({
  label,
  description,
  defaultText,
  value,
  onChange,
  onReset,
  rows = 12,
}: {
  label: string;
  description?: string;
  defaultText: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  rows?: number;
}) {
  const lines = value.split('\n').length;
  const chars = value.length;
  const isDefault = value.trim() === defaultText.trim();

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold">{label}</div>
          {description && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div>
          )}
        </div>
        {!isDefault && (
          <Button variant="ghost" size="sm" onClick={onReset} className="shrink-0">
            <RotateCcw className="h-3.5 w-3.5" />
            Сбросить
          </Button>
        )}
      </div>
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isDefault ? 'Используется дефолтный' : 'Кастомный override'}
          </div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {lines} стр. · {chars} симв.
          </div>
        </div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          spellCheck={false}
          className="w-full resize-y bg-transparent p-3 font-mono text-xs leading-relaxed focus:outline-none"
          placeholder="Оставьте пустым для использования дефолтного промпта…"
        />
      </div>
    </div>
  );
}

// =====================================================================
// Tab 1: Global
// =====================================================================

function GlobalTab() {
  const [data, setData] = useState<{ default: string; custom: string; usingDefault: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ai/system-prompt');
    const json = await res.json() as { ok: boolean; default: string; custom: string; usingDefault: boolean };
    if (json.ok) {
      setData({ default: json.default, custom: json.custom, usingDefault: json.usingDefault });
      setDraft(json.custom?.trim() ? json.custom : json.default);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const isSameAsDefault = draft.trim() === data.default.trim();
      await fetch('/api/admin/ai/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: isSameAsDefault ? '' : draft }),
      });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  const isDirty = data
    ? draft !== (data.custom?.trim() ? data.custom : data.default)
    : false;

  return (
    <div className="space-y-4">
      {data && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {data.usingDefault
              ? 'Используется дефолтный prompt. Отредактируйте и сохраните для применения ко всем AI-вызовам.'
              : 'Используется ваша кастомная версия. Сбросьте к дефолту если нужно.'}
          </AlertDescription>
        </Alert>
      )}

      {data ? (
        <PromptEditor
          label="Глобальный system prompt"
          description="Инструкция которую AI получает перед каждым запросом — роль, правила, формат ответа."
          defaultText={data.default}
          value={draft}
          onChange={setDraft}
          onReset={() => setDraft(data.default)}
          rows={20}
        />
      ) : (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={!isDirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        {savedAt && <span className="text-[11px] text-emerald-600">Сохранено в {savedAt}</span>}
      </div>
    </div>
  );
}

// =====================================================================
// Tab 2: Sections
// =====================================================================

function SectionsTab() {
  const [groups, setGroups] = useState<SectionGroupData[]>([]);
  const [pageOverrides, setPageOverrides] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ai/prompts/sections');
    const data = await res.json() as { ok: boolean; groups: SectionGroupData[]; pageOverrides: Record<string, string> };
    if (data.ok) {
      setGroups(data.groups);
      setPageOverrides(data.pageOverrides ?? {});
      const init: Record<string, string> = {};
      for (const g of data.groups) init[g.id] = g.custom || g.default || '';
      setDrafts(init);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/admin/ai/prompts/sections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: drafts, pages: pageOverrides }),
      });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Промпт уровня раздела добавляется к системному промпту при AI-анализе страницы. Оставьте пустым для использования дефолтного.
        </AlertDescription>
      </Alert>

      {groups.length === 0 ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isOpen = expanded.has(g.id);
            const draft = drafts[g.id] ?? '';
            const isDirty = draft !== (g.custom ?? '');
            return (
              <div key={g.id} className="rounded-lg border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => setExpanded(prev => {
                    const s = new Set(prev);
                    s.has(g.id) ? s.delete(g.id) : s.add(g.id);
                    return s;
                  })}
                >
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {g.label}
                      {draft.trim() && draft.trim() !== g.default.trim() ? (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">кастомный</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{g.description}</div>
                  </div>
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
                {isOpen && (
                  <div className="border-t p-3">
                    <PromptEditor
                      label={`Промпт для группы «${g.label}»`}
                      description={`Дефолт: ${g.default.slice(0, 80)}…`}
                      defaultText={g.default}
                      value={draft}
                      onChange={(v) => setDrafts(prev => ({ ...prev, [g.id]: v }))}
                      onReset={() => setDrafts(prev => ({ ...prev, [g.id]: g.default }))}
                      rows={8}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Сохраняем…' : 'Сохранить все'}
        </Button>
        {savedAt && <span className="text-[11px] text-emerald-600">Сохранено в {savedAt}</span>}
      </div>
    </div>
  );
}

// =====================================================================
// Tab 3: Blocks
// =====================================================================

function BlocksTab() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ai/prompts/blocks');
    const data = await res.json() as { ok: boolean; blocks: BlockData[] };
    if (data.ok) {
      setBlocks(data.blocks);
      const init: Record<string, string> = {};
      for (const b of data.blocks) init[b.type] = b.custom || b.default || '';
      setDrafts(init);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/admin/ai/prompts/blocks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: drafts }),
      });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  const filtered = blocks.filter((b) =>
    !search || b.displayName.toLowerCase().includes(search.toLowerCase()) || b.type.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Skill-промпт уровня блока: что блок делает, какие данные содержит, как помогать.
          Отображается пользователю как read-only «Универсальный навык» в настройках блока.
        </AlertDescription>
      </Alert>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по типу или названию блока…"
          className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {blocks.length === 0 ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map((b, index) => {
            const isOpen = expanded.has(b.type);
            const draft = drafts[b.type] ?? '';
            return (
              <div key={b.type || `block-${index}`} className="rounded-lg border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  onClick={() => setExpanded(prev => {
                    const s = new Set(prev);
                    s.has(b.type) ? s.delete(b.type) : s.add(b.type);
                    return s;
                  })}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <span className="truncate">{b.displayName}</span>
                      {draft.trim() && draft.trim() !== b.default.trim() ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">кастомный</span>
                      ) : null}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground">{b.type}</div>
                  </div>
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                </button>
                {isOpen && (
                  <div className="border-t p-3">
                    <PromptEditor
                      label={b.displayName}
                      defaultText={b.default || '(нет дефолтного промпта)'}
                      value={draft}
                      onChange={(v) => setDrafts(prev => ({ ...prev, [b.type]: v }))}
                      onReset={() => setDrafts(prev => ({ ...prev, [b.type]: b.default }))}
                      rows={6}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Сохраняем…' : 'Сохранить все'}
        </Button>
        {savedAt && <span className="text-[11px] text-emerald-600">Сохранено в {savedAt}</span>}
      </div>
    </div>
  );
}

// =====================================================================
// Tab 4: Pointwise
// =====================================================================

function PointwiseTab() {
  const [data, setData] = useState<{ default: string; custom: string; usingDefault: boolean } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ai/prompts/pointwise');
    const json = await res.json() as { ok: boolean; default: string; custom: string; usingDefault: boolean };
    if (json.ok) {
      setData(json);
      setDraft(json.custom?.trim() ? json.custom : json.default);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const isSameAsDefault = draft.trim() === data.default.trim();
      await fetch('/api/admin/ai/prompts/pointwise', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: isSameAsDefault ? '' : draft }),
      });
      setSavedAt(new Date().toLocaleTimeString('ru-RU'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  const isDirty = data ? draft !== (data.custom?.trim() ? data.custom : data.default) : false;

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Prompt для анализа блока в контексте его dependency-tree (автоподбор связанных блоков в «AI Анализ»).
          Используется когда выбран режим «Только связанные» в диалоге анализа раздела.
        </AlertDescription>
      </Alert>

      {data ? (
        <PromptEditor
          label="Промпт анализа связей (pointwise)"
          description="Применяется при анализе зависимостей между блоками."
          defaultText={data.default}
          value={draft}
          onChange={setDraft}
          onReset={() => setDraft(data.default)}
          rows={14}
        />
      ) : (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={!isDirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        {savedAt && <span className="text-[11px] text-emerald-600">Сохранено в {savedAt}</span>}
      </div>
    </div>
  );
}

// =====================================================================
// Main
// =====================================================================

const TABS: { id: PromptTab; label: string; description: string }[] = [
  { id: 'global', label: 'Глобальный', description: 'System prompt для всех AI-вызовов' },
  { id: 'sections', label: 'Разделы', description: 'Промпты для разделов приложения' },
  { id: 'blocks', label: 'Блоки', description: 'Skill-промпты для типов блоков' },
  { id: 'pointwise', label: 'Точечные связи', description: 'Промпт анализа зависимостей' },
];

export default function SystemPromptPage() {
  const [tab, setTab] = useState<PromptTab>('global');

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <div className="border-b border-border/60 pb-3">
        <h1 className="text-lg font-semibold tracking-tight">AI Промпты</h1>
        <p className="text-xs text-muted-foreground">
          4-уровневая иерархия: глобальный → разделы → блоки → пользовательское дополнение
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title={t.description}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'global' && <GlobalTab />}
      {tab === 'sections' && <SectionsTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'pointwise' && <PointwiseTab />}
    </div>
  );
}
