// PURPOSE: Блок «Заметка» (note.markdown) — markdown-заметка в стиле Zettlr/Notion.
//   Два режима: «Текст» (WYSIWYG, как Telegraph) и «MD» (сырой markdown). Под капотом
//   один markdown-документ (config.content) + MDXEditor (dynamic, ssr:false).
//   Шапка: заголовок + счётчики (символы/слова/строки/≈токены) + переключатель
//   режима + импорт/экспорт .md/.txt. Публикует счётчики/заголовок/дату в «Связи».
'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { useTheme } from 'next-themes';
import { z } from 'zod';
import { NotebookPen, Download, Upload, FileDown, FileText } from 'lucide-react';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { useBlockValuePublisher } from '../values';
import { useBlockDensity } from '@/components/blocks/block-size';
import { ForwardRefEditor } from '@/components/blocks/markdown/ForwardRefEditor';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ============================================================================
// Config
// ============================================================================

const NoteConfig = z.object({
  /** Markdown-документ — источник правды. */
  content: z.string().default(''),
  /** Явный заголовок; если пусто — берётся из первого # H1 / первой строки. */
  title: z.string().default(''),
  /** Режим по умолчанию при открытии страницы. */
  defaultMode: z.enum(['wysiwyg', 'markdown']).default('wysiwyg'),
  /** Показывать строку счётчиков в шапке. */
  showCounters: z.boolean().default(true),
  /** Делитель символов для эвристической оценки токенов (≈ chars/divisor). */
  tokenDivisor: z.number().min(1).max(20).default(4),
  /** ISO-дата последнего изменения (для публикации в связи). */
  updatedAt: z.string().default(''),
});
type NoteCfg = z.infer<typeof NoteConfig>;

// ============================================================================
// Helpers
// ============================================================================

function resolveNoteTitle(explicit: string, content: string): string {
  if (explicit.trim()) return explicit.trim();
  for (const raw of content.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^#{1,6}\s+/, '').trim();
    if (line) return line.slice(0, 80);
  }
  return 'Заметка';
}

function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'note';
}

/** Грубое удаление markdown-разметки для экспорта в .txt. */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Editor (memoized) — изолирует MDXEditor от ре-рендеров счётчиков
// ============================================================================

const NoteEditor = memo(function NoteEditor({
  initialMarkdown,
  onChange,
  desiredViewMode,
  dark,
  editorRef,
}: {
  initialMarkdown: string;
  onChange: (md: string) => void;
  desiredViewMode: 'rich-text' | 'source';
  dark: boolean;
  editorRef: RefObject<MDXEditorMethods>;
}) {
  return (
    <ForwardRefEditor
      ref={editorRef}
      markdown={initialMarkdown}
      onChange={onChange}
      desiredViewMode={desiredViewMode}
      className={dark ? 'dark-theme' : undefined}
      contentEditableClassName="note-md-content"
      placeholder="Начните писать заметку…"
    />
  );
});

// ============================================================================
// Render
// ============================================================================

function RenderMarkdownNote({ instance, onConfigChange }: BlockRenderProps) {
  const cfg = useMemo(() => NoteConfig.parse(instance.config ?? {}), [instance.config]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const density = useBlockDensity();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const editorRef = useRef<MDXEditorMethods>(null);
  const initialMarkdown = useRef(cfg.content).current;
  const latestRef = useRef(cfg.content);
  const committedRef = useRef(cfg.content);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setMode] = useState<'wysiwyg' | 'markdown'>(cfg.defaultMode);
  const [counterContent, setCounterContent] = useState(cfg.content);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);

  // Единая точка коммита в config — фиксирует committedRef (защита от ревёрта
  // редактора внешним sync-эффектом во время активного набора).
  const commit = useCallback(
    (content: string, extra?: Partial<NoteCfg>) => {
      committedRef.current = content;
      onConfigChange?.({
        ...cfgRef.current,
        content,
        updatedAt: new Date().toISOString(),
        ...extra,
      });
    },
    [onConfigChange],
  );

  // onChange редактора срабатывает на каждый ввод — дебаунсим счётчики и коммит,
  // чтобы не дёргать config (полный ре-рендер сетки + сетевой save) по символу.
  const handleChange = useCallback(
    (md: string) => {
      latestRef.current = md;
      if (counterTimer.current) clearTimeout(counterTimer.current);
      counterTimer.current = setTimeout(() => setCounterContent(md), 250);
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        commit(md);
      }, 700);
    },
    [commit],
  );

  const flushCommit = useCallback(() => {
    if (!commitTimer.current) return;
    clearTimeout(commitTimer.current);
    commitTimer.current = null;
    commit(latestRef.current);
  }, [commit]);

  useEffect(
    () => () => {
      if (counterTimer.current) clearTimeout(counterTimer.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    [],
  );

  // Внешнее изменение content (импорт через диалог настроек, AI-apply) —
  // синхронизируем редактор. Срабатывает только если значение НЕ из нашего
  // коммита (committedRef), иначе во время набора затёрли бы свежий текст.
  useEffect(() => {
    if (cfg.content !== committedRef.current) {
      committedRef.current = cfg.content;
      latestRef.current = cfg.content;
      setCounterContent(cfg.content);
      editorRef.current?.setMarkdown(cfg.content);
    }
  }, [cfg.content]);

  function switchMode(next: 'wysiwyg' | 'markdown') {
    if (next === mode) return;
    setMode(next);
    commit(latestRef.current, { defaultMode: next });
  }

  function exportMd() {
    downloadText(`${safeName(title)}.md`, latestRef.current, 'text/markdown;charset=utf-8');
  }
  function exportTxt() {
    downloadText(`${safeName(title)}.txt`, stripMarkdown(latestRef.current), 'text/plain;charset=utf-8');
  }

  function pickFile() {
    fileInputRef.current?.click();
  }
  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (latestRef.current.trim().length > 0) {
      setPendingImport(text);
    } else {
      applyImport(text);
    }
  }
  function applyImport(text: string) {
    latestRef.current = text;
    setCounterContent(text);
    editorRef.current?.setMarkdown(text);
    commit(text);
    setPendingImport(null);
  }

  const counters = useMemo(() => {
    const text = counterContent ?? '';
    const chars = text.length;
    const words = (text.trim().match(/\S+/g) ?? []).length;
    const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length;
    const tokens = Math.ceil(chars / Math.max(1, cfg.tokenDivisor));
    return { chars, words, lines, tokens };
  }, [counterContent, cfg.tokenDivisor]);

  const title = useMemo(
    () => resolveNoteTitle(cfg.title, counterContent),
    [cfg.title, counterContent],
  );

  useBlockValuePublisher(instance.id, {
    value: counters.chars,
    chars: counters.chars,
    words: counters.words,
    lines: counters.lines,
    tokens: counters.tokens,
    title,
    updatedAt: cfg.updatedAt || '',
    __labels:
      'chars=Символы,words=Слова,lines=Строки,tokens=Токены (≈),title=Заголовок,updatedAt=Изменён',
  });

  const accent = instance.appearance?.accentColor;
  const borderStyle = accent ? { borderColor: accent } : undefined;
  const showCountersRow = cfg.showCounters && density !== 'xs' && density !== 'sm';
  const compact = density === 'xs' || density === 'sm';

  return (
    <Card className="flex h-full flex-col overflow-hidden" style={borderStyle}>
      {/* Шапка блока: заголовок · счётчики · режим · импорт/экспорт */}
      <div className="flex items-center gap-1.5 border-b bg-muted/20 px-2 py-1">
        <NotebookPen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" style={accent ? { color: accent } : undefined} />
        <span className="truncate text-[12px] font-semibold" title={title}>
          {title}
        </span>

        {showCountersRow && (
          <span className="ml-1 shrink-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
            {counters.chars} симв · {counters.words} сл · ≈{counters.tokens} ток
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/* Переключатель режима */}
          <div className="flex items-center rounded-md border bg-background p-0.5">
            <button
              type="button"
              onClick={() => switchMode('wysiwyg')}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition',
                mode === 'wysiwyg'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Текст (WYSIWYG)"
            >
              Текст
            </button>
            <button
              type="button"
              onClick={() => switchMode('markdown')}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition',
                mode === 'markdown'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Markdown (исходник)"
            >
              MD
            </button>
          </div>

          {/* Импорт / экспорт */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Импорт / экспорт">
                <Download className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem onClick={pickFile}>
                <Upload className="h-3.5 w-3.5" /> Импорт (.md / .txt)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportMd}>
                <FileDown className="h-3.5 w-3.5" /> Скачать .md
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportTxt}>
                <FileText className="h-3.5 w-3.5" /> Скачать .txt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Компактные счётчики для маленьких блоков */}
      {cfg.showCounters && compact && (
        <div className="border-b px-2 py-0.5 text-[9px] tabular-nums text-muted-foreground">
          {counters.chars}с · {counters.words}сл · ≈{counters.tokens}т
        </div>
      )}

      {/* Редактор — тянется под блок, скролл внутри */}
      <div className="note-md-editor min-h-0 flex-1" onBlur={flushCommit}>
        <NoteEditor
          initialMarkdown={initialMarkdown}
          onChange={handleChange}
          desiredViewMode={mode === 'markdown' ? 'source' : 'rich-text'}
          dark={isDark}
          editorRef={editorRef}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={onFileChange}
      />

      <AlertDialog open={pendingImport !== null} onOpenChange={(o) => { if (!o) setPendingImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заменить содержимое заметки?</AlertDialogTitle>
            <AlertDialogDescription>
              В блоке уже есть текст. Импорт файла полностью заменит текущее содержимое.
              Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingImport !== null && applyImport(pendingImport)}>
              Заменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============================================================================
// Settings
// ============================================================================

function MarkdownNoteSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = NoteConfig.parse(config ?? {});
  function set<K extends keyof NoteCfg>(key: K, value: NoteCfg[K]) {
    onChange({ ...cfg, [key]: value });
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="note-title">Заголовок</Label>
        <Input
          id="note-title"
          value={cfg.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Авто (из первой строки)"
        />
        <p className="text-[11px] text-muted-foreground">
          Если пусто — берётся из первого заголовка <code>#</code> или первой строки.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Режим по умолчанию</Label>
        <div className="flex items-center rounded-md border bg-background p-0.5">
          {(['wysiwyg', 'markdown'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set('defaultMode', m)}
              className={cn(
                'flex-1 rounded px-2 py-1 text-xs font-medium transition',
                cfg.defaultMode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'wysiwyg' ? 'Текст (WYSIWYG)' : 'Markdown'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border p-2.5">
        <div>
          <div className="text-sm font-medium">Счётчики</div>
          <div className="text-[11px] text-muted-foreground">
            Символы / слова / строки / ≈токены в шапке
          </div>
        </div>
        <Switch checked={cfg.showCounters} onCheckedChange={(v) => set('showCounters', v)} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note-divisor">Символов на токен (оценка)</Label>
        <Input
          id="note-divisor"
          type="number"
          min={1}
          max={20}
          value={cfg.tokenDivisor}
          onChange={(e) => set('tokenDivisor', Math.max(1, Math.min(20, Number(e.target.value) || 4)))}
        />
        <p className="text-[11px] text-muted-foreground">
          Грубая эвристика: токены ≈ символы / N (для англ. ~4, для русского обычно меньше).
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// BlockDef
// ============================================================================

export const MarkdownNoteBlock: BlockDef = {
  type: 'note.markdown',
  displayName: 'Заметка',
  description:
    'Markdown-заметка с WYSIWYG и режимом исходника, счётчиками символов/слов/токенов и импортом/экспортом .md/.txt',
  category: 'custom',
  icon: NotebookPen,
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 220, h: 120 },
  pages: ['*'],
  configSchema: NoteConfig,
  defaultConfig: () => ({
    content: '',
    title: '',
    defaultMode: 'wysiwyg',
    showCounters: true,
    tokenDivisor: 4,
    updatedAt: '',
  }),
  SettingsForm: MarkdownNoteSettings,
  Render: RenderMarkdownNote,
};
