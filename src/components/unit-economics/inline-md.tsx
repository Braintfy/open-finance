// PURPOSE: Минимальный inline-рендер markdown-эмфазиса для текста ИИ-инсайтов.
// ИИ-модели иногда оборачивают числа в **жирный** / *курсив* — без рендера
// это видно как сырые звёздочки. Лёгкий парсер без зависимостей: **bold**,
// __bold__, *italic*, _italic_. Всё остальное — обычный текст.
'use client';

import { Fragment, type ReactNode } from 'react';

type Token = { kind: 'text' | 'bold' | 'italic'; value: string };

// Порядок важен: bold (** или __) до italic (* или _), чтобы не съесть жирный.
const PATTERN = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  PATTERN.lastIndex = 0;
  while ((m = PATTERN.exec(input)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: input.slice(last, m.index) });
    if (m[2] !== undefined) {
      tokens.push({ kind: 'bold', value: m[2] });
    } else if (m[4] !== undefined) {
      tokens.push({ kind: 'italic', value: m[4] });
    }
    last = PATTERN.lastIndex;
  }
  if (last < input.length) tokens.push({ kind: 'text', value: input.slice(last) });
  return tokens;
}

/** Рендерит строку с поддержкой **жирного** и *курсива* в React-узлы. */
export function renderInlineMd(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const tokens = tokenize(text);
  return tokens.map((t, i) => {
    if (t.kind === 'bold')
      return (
        <strong key={i} className="font-semibold text-foreground">
          {t.value}
        </strong>
      );
    if (t.kind === 'italic') return <em key={i}>{t.value}</em>;
    return <Fragment key={i}>{t.value}</Fragment>;
  });
}
