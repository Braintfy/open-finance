// PURPOSE: Dynamic-import обёртка над InitializedMDXEditor (ssr:false).
//   Только этот файл импортируется блоком note.markdown — он НЕ тянет
//   @mdxeditor/editor в статический граф (type-only импорты стираются),
//   поэтому редактор грузится отдельным чанком на клиенте по требованию.
'use client';

import dynamic from 'next/dynamic';
import { forwardRef } from 'react';
import type {
  MDXEditorMethods,
  MDXEditorProps,
  ViewMode,
} from '@mdxeditor/editor';

export type ForwardRefEditorProps = MDXEditorProps & {
  desiredViewMode?: ViewMode;
};

const Editor = dynamic(() => import('./InitializedMDXEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
      Загрузка редактора…
    </div>
  ),
});

export const ForwardRefEditor = forwardRef<MDXEditorMethods, ForwardRefEditorProps>(
  (props, ref) => <Editor {...props} editorRef={ref} />,
);

ForwardRefEditor.displayName = 'ForwardRefEditor';
