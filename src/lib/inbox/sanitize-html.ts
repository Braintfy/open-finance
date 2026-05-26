// PURPOSE: Санитизация HTML-тел писем + замена <img src> на data-src для lazy-load.
// Используется ТОЛЬКО на клиенте (EmailHtmlBody в 'use client'-блоке). На SSR
// возвращает no-op (пустой html, hasImages=false) — реальный санитайз произойдёт
// при первом client-render через useMemo.
//
// Почему `dompurify` (browser-only), а не `isomorphic-dompurify`: последний
// тащит за собой jsdom, который webpack Next.js не умеет корректно бандлить
// (mangles `__dirname` → jsdom не может найти `browser/default-stylesheet.css`).
// Картинки в DB НЕ хранятся — оригинальные URL остаются в data-src и грузятся
// on-demand с внешних серверов по нажатию пользователя.
import DOMPurify from 'dompurify';

/**
 * Лёгкий 1×1 SVG-плейсхолдер, чтобы `<img>` всё равно отрисовывал box
 * (width/height из исходных атрибутов или CSS) даже без реального источника.
 */
const IMG_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E";

const ALLOWED_TAGS = [
  'p', 'div', 'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'br', 'hr',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'figure', 'figcaption',
];

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'width', 'height', 'style',
  'colspan', 'rowspan', 'align', 'valign',
  'target', 'rel',
  'border', 'cellpadding', 'cellspacing',
];

export type SanitizedEmailHtml = {
  html: string;
  hasImages: boolean;
};

/**
 * Санитизирует email HTML: вырезает script/iframe/onclick-атрибуты,
 * затем подменяет `<img src="...">` на `<img data-src="..." src="placeholder"
 * data-blocked="1">`. Клиент при клике на «Загрузить картинки» обходит
 * `[data-blocked="1"]` и восстанавливает src из data-src.
 *
 * Также для `<a>` добавляет `target="_blank" rel="noopener noreferrer"`,
 * чтобы клики не покидали приложение.
 *
 * SSR-safe: если вызывается на сервере (нет `window`), возвращает no-op —
 * реальная санитизация произойдёт при гидратации через `useMemo`.
 */
export function sanitizeEmailHtml(html: string): SanitizedEmailHtml {
  if (!html) return { html: '', hasImages: false };
  if (typeof window === 'undefined' || typeof DOMPurify.sanitize !== 'function') {
    return { html: '', hasImages: false };
  }

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|cid:|#)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link', 'base', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onsubmit'],
  });

  let hasImages = false;
  let result = clean.replace(/<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi, (_, before, q, src, after) => {
    hasImages = true;
    const safeSrc = String(src).replace(/"/g, '&quot;');
    return `<img${before}src="${IMG_PLACEHOLDER}" data-src=${q}${safeSrc}${q} data-blocked="1"${after}>`;
  });

  // `<a>` → target=_blank + rel=noopener
  result = result.replace(/<a\b([^>]*)>/gi, (_full, attrs: string) => {
    const hasTarget = /\btarget=/.test(attrs);
    const hasRel = /\brel=/.test(attrs);
    let next = attrs;
    if (!hasTarget) next += ' target="_blank"';
    if (!hasRel) next += ' rel="noopener noreferrer"';
    return `<a${next}>`;
  });

  return { html: result, hasImages };
}
