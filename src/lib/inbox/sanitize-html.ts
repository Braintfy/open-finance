// PURPOSE: Санитизация HTML-тел писем + сборка srcdoc для sandboxed-iframe.
// Используется ТОЛЬКО на клиенте (EmailHtmlBody в 'use client'-блоке). На SSR
// `sanitizeEmailHtml` возвращает no-op (пустой html) — реальный санитайз
// произойдёт при первом client-render через useMemo.
//
// Письмо рендерится в <iframe srcdoc> (sandbox без allow-scripts/allow-same-origin),
// поэтому санитайзер может быть достоверным: сохраняем <style>, class/id, font/center
// (нужно для вёрстки писем и скрытия preheader `.preheader{display:none}`). Sandbox —
// граница безопасности; DOMPurify оставляем как defense-in-depth (срезает script и пр.).
//
// Почему `dompurify` (browser-only), а не `isomorphic-dompurify`: последний
// тащит за собой jsdom, который webpack Next.js не умеет корректно бандлить
// (mangles `__dirname` → jsdom не может найти `browser/default-stylesheet.css`).
// Картинки в DB НЕ хранятся — грузятся on-demand с внешних URL по кнопке
// (см. buildEmailSrcDoc: при showImages=false `<img src>` нейтрализуется).
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
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'figure', 'figcaption',
  'style', 'center', 'font', 'small', 'sub', 'sup',
];

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src', 'srcset', 'width', 'height', 'style',
  'class', 'id', 'dir', 'lang',
  'colspan', 'rowspan', 'align', 'valign', 'nowrap',
  'target', 'rel',
  'border', 'cellpadding', 'cellspacing',
  'bgcolor', 'background', 'color', 'face', 'size',
];

export type SanitizedEmailHtml = {
  html: string;
  hasImages: boolean;
};

/**
 * Санитизирует email HTML: вырезает script/iframe/object/form и on*-атрибуты,
 * но СОХРАНЯЕТ `<style>`, class/id, font/center и табличные атрибуты — для
 * достоверной вёрстки письма внутри sandboxed-iframe. Возвращает `{ html,
 * hasImages }`; гейтинг картинок выполняется в `buildEmailSrcDoc`.
 *
 * Также для `<a>` добавляет `target="_blank" rel="noopener noreferrer"`,
 * чтобы клики открывались в новой вкладке (вне sandbox).
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
    // <style> и class/id СОХРАНЯЕМ — нужны для вёрстки письма и скрытия
    // preheader. Безопасно: рендер в sandboxed-iframe (см. buildEmailSrcDoc).
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'meta', 'link', 'base', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onsubmit'],
  });

  const hasImages = /<img\b/i.test(clean);

  // `<a>` → target=_blank + rel=noopener (открывать ссылки вне sandbox).
  const result = clean.replace(/<a\b([^>]*)>/gi, (_full, attrs: string) => {
    const hasTarget = /\btarget=/.test(attrs);
    const hasRel = /\brel=/.test(attrs);
    let next = attrs;
    if (!hasTarget) next += ' target="_blank"';
    if (!hasRel) next += ' rel="noopener noreferrer"';
    return `<a${next}>`;
  });

  return { html: result, hasImages };
}

// ============================================================================
// buildEmailSrcDoc — сборка полного HTML-документа для <iframe srcdoc>
// ============================================================================

/** Базовые стили документа письма (письмо переопределит своими inline/<style>). */
const BASE_CSS = `
  html,body{margin:0;padding:0;}
  body{background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;padding:12px;word-break:break-word;-webkit-text-size-adjust:100%;}
  img{max-width:100%;height:auto;border:0;}
  table{max-width:100%;}
  a{color:#2563eb;}
  ::-webkit-scrollbar{width:10px;height:10px;}
  ::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2);border-radius:5px;}
`;

/** Нейтрализует загрузку картинок: src→плейсхолдер, убирает srcset/background. */
function blockImages(html: string): string {
  return html
    .replace(/(<img\b[^>]*?)\ssrc=(["'])[^"']*\2/gi, `$1 src="${IMG_PLACEHOLDER}"`)
    .replace(/(<img\b[^>]*?)\ssrcset=(["'])[^"']*\2/gi, '$1')
    .replace(/(<[^>]*?)\sbackground=(["'])[^"']*\2/gi, '$1');
}

/**
 * Собирает полноценный HTML-документ для `<iframe srcdoc>`: charset utf-8
 * (чинит кодировки тела), `<base target="_blank">` (ссылки в новой вкладке),
 * базовые стили. При `showImages=false` картинки нейтрализуются (privacy/трафик).
 */
export function buildEmailSrcDoc(cleanHtml: string, opts: { showImages: boolean }): string {
  const body = opts.showImages ? cleanHtml : blockImages(cleanHtml);
  return (
    '<!doctype html><html><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<base target="_blank">' +
    `<style>${BASE_CSS}</style>` +
    `</head><body>${body}</body></html>`
  );
}
