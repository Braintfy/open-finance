// PURPOSE: Client-only инстанс MDXEditor для блока note.markdown.
//   Этот файл — ЕДИНСТВЕННОЕ место, где @mdxeditor/editor (+ CSS) импортируется
//   напрямую. Подключается ТОЛЬКО через dynamic(ssr:false) из ForwardRefEditor,
//   поэтому тяжёлый редактор (~850 kB) попадает в отдельный async-чанк и не
//   раздувает общий бандл блоков / не ломает SSR.
//
//   Переключение режима «Текст»↔«MD» = rich-text↔source через viewMode$:
//   ModeBridge (рендерится внутри realm в toolbarContents) читает desiredViewMode
//   из локального контекста (объявлен в ЭТОМ же модуле — гарантированно один
//   инстанс контекста внутри dynamic-чанка) и публикует его в viewMode$.
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ForwardedRef,
} from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  markdownShortcutPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  ListsToggle,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  viewMode$,
  usePublisher,
  useCellValues,
  type MDXEditorMethods,
  type MDXEditorProps,
  type ViewMode,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

const ViewModeCtx = createContext<ViewMode>('rich-text');

/**
 * Bridge внутри realm: синхронизирует желаемый режим (из ViewModeCtx) с
 * внутренним viewMode$ редактора и рендерит тулбар форматирования только в
 * rich-text («Текст») режиме. В source («MD») режиме — голый markdown, тулбар скрыт.
 */
function ModeBridgeToolbar() {
  const desired = useContext(ViewModeCtx);
  const [current] = useCellValues(viewMode$);
  const setViewMode = usePublisher(viewMode$);
  useEffect(() => {
    if (current !== desired) setViewMode(desired);
  }, [desired, current, setViewMode]);
  if (current !== 'rich-text') return null;
  return (
    <>
      <UndoRedo />
      <BoldItalicUnderlineToggles />
      <BlockTypeSelect />
      <ListsToggle />
      <CreateLink />
      <InsertTable />
      <InsertThematicBreak />
    </>
  );
}

type InitializedProps = {
  editorRef: ForwardedRef<MDXEditorMethods> | null;
  /** Желаемый режим отображения; меняется кнопками в шапке блока. */
  desiredViewMode?: ViewMode;
} & MDXEditorProps;

export default function InitializedMDXEditor({
  editorRef,
  desiredViewMode = 'rich-text',
  ...props
}: InitializedProps) {
  // Начальный режим фиксируем на маунте (diffSourcePlugin принимает initial),
  // дальше им управляет ModeBridge через viewMode$.
  const initialViewMode = useRef(desiredViewMode).current;
  // Плагины создаём один раз — иначе MDXEditor реинициализирует realm на каждый
  // ре-рендер (сброс курсора/истории).
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: initialViewMode, diffMarkdown: '' }),
      toolbarPlugin({ toolbarContents: () => <ModeBridgeToolbar /> }),
    ],
    [initialViewMode],
  );

  return (
    <ViewModeCtx.Provider value={desiredViewMode}>
      <MDXEditor plugins={plugins} {...props} ref={editorRef} />
    </ViewModeCtx.Provider>
  );
}
