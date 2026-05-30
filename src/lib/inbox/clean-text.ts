// PURPOSE: Декодирование HTML-entities и чистка текста писем для превью/plain-text.
//   Работает БЕЗ DOM (и на сервере при синке, и на клиенте при рендере), чтобы
//   маркетинговый preheader-мусор (литеральные `&zwnj;`/`&nbsp;`-набивки) не
//   попадал в превью списка и в plain-text fallback.

/** Минимальная карта именованных HTML-entities, встречающихся в письмах. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  zwnj: '\u200C',
  zwj: '\u200D',
  shy: '\u00AD',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  laquo: '\u00AB',
  raquo: '\u00BB',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201C',
  rdquo: '\u201D',
  middot: '\u00B7',
  bull: '\u2022',
  deg: '\u00B0',
  euro: '\u20AC',
  pound: '\u00A3',
  cent: '\u00A2',
};

/** Символы нулевой ширины + soft-hyphen — мусор preheader-набивки. */
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u00AD\u2060]/g;

/**
 * Декодирует HTML-entities в строке: numeric (`&#123;`), hex (`&#x1f;`) и
 * именованные (по карте `NAMED_ENTITIES`). Неизвестные именованные оставляет
 * как есть.
 */
export function decodeEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input ?? '';
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Убирает символы нулевой ширины и soft-hyphen. */
export function stripZeroWidth(input: string): string {
  return (input ?? '').replace(ZERO_WIDTH_RE, '');
}

/**
 * Чистит текст для превью/отображения: декодирует entities, убирает символы
 * нулевой ширины (preheader-набивка `&zwnj;`), схлопывает пробелы/NBSP/переводы
 * строк в один пробел и обрезает по краям. Опционально режет до `maxLength`.
 */
export function cleanPreview(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';
  let text = decodeEntities(input);
  text = stripZeroWidth(text);
  text = text.replace(/[\s\u00A0]+/g, ' ').trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength).trim();
  return text;
}

/**
 * Чистит plain-text тело письма для рендера: декодирует entities, убирает
 * символы нулевой ширины, но СОХРАНЯЕТ переводы строк (для whitespace-pre-wrap).
 * Только схлопывает горизонтальные пробелы/NBSP и убирает хвостовые пробелы строк.
 */
export function cleanPlainTextBody(input: string | null | undefined): string {
  if (!input) return '';
  let text = decodeEntities(input);
  text = stripZeroWidth(text);
  text = text
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
