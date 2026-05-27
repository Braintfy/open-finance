// PURPOSE: Helpers для трансформации формул при экспорте/импорте блоков в XLSX.
//
// Задачи:
//   1. **A1-shift** — для `custom.data` блок-A1 (A = первая user-колонка,
//      row 1 = первая data-строка) ≠ Excel-A1 (A = «Строка», row 1 = header).
//      Все A1-адреса внутри формул нужно сдвигать при экспорте и обратно при
//      импорте.
//
//   2. **@-substitution** — Excel не понимает `@blockId.field` (cross-block
//      reference); пишем числовое значение из snapshot (`cfg.blockRefs`) или
//      live store. Если значение неизвестно — заменяем на `0` (UI потом
//      покажет «Битая ссылка» при импорте обратно).
//
// Алгоритм A1-shift:
//   - Регэксп `\b([A-Z]+)(\d+)\b` ловит и одиночные адреса (A1), и части
//     диапазонов (A1:B5 → совпадает дважды).
//   - Чтобы не задеть текст внутри строковых литералов формулы ("A1"), пропускаем
//     совпадения внутри парных двойных кавычек. Это не academic correctness, но
//     для практики хватает (формулы Excel редко содержат строки-литералы вида
//     "A1").

const A1_RE = /\b([A-Z]+)(\d+)\b/g;
const AT_REF_RE = /@([A-Za-z0-9_.:()-]+)/g;

/** Letter → 0-based column index (A=0, B=1, ..., AA=26). */
function colIndex(letter: string): number {
  let n = 0;
  for (let i = 0; i < letter.length; i += 1) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** 0-based column index → letter. */
function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || 'A';
}

/**
 * Сдвинуть все A1-адреса в формуле на `colShift` колонок и `rowShift` строк.
 * Формула передаётся БЕЗ ведущего `=`. Возвращает новую строку без `=`.
 *
 * @param formula     `A1+B2*60` (без `=`)
 * @param colShift    +1 — столбцы сдвигаются вправо
 * @param rowShift    +1 — строки сдвигаются вниз
 *
 * Адреса с отрицательной координатой после сдвига оставляются как `#REF!`
 * (Excel-конвенция для битых ссылок).
 */
export function shiftA1Addresses(formula: string, colShift: number, rowShift: number): string {
  if (colShift === 0 && rowShift === 0) return formula;
  let inString = false;
  let out = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      inString = !inString;
      out += ch;
      i += 1;
      continue;
    }
    if (inString) {
      out += ch;
      i += 1;
      continue;
    }
    // Не внутри строки — пробуем матч A1
    A1_RE.lastIndex = i;
    const m = A1_RE.exec(formula);
    if (m && m.index === i) {
      const c = colIndex(m[1]) + colShift;
      const r = Number(m[2]) + rowShift;
      if (c < 0 || r < 1) {
        out += '#REF!';
      } else {
        out += `${colLetter(c)}${r}`;
      }
      i += m[0].length;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Подставить @-references в формуле численными значениями.
 * Формула передаётся БЕЗ ведущего `=`. Возвращает `{ result, unresolved }`:
 *   - `result`     — формула с подставленными числами.
 *   - `unresolved` — количество @-ссылок, которые не удалось разрешить (0
 *                    остался как `0`, но факт остаётся записанным для UI).
 *
 * Алгоритм поиска значения:
 *   1. `liveValues[refName]` — точное совпадение
 *   2. Если ref = `blockId.field` → `liveValues['blockId.field']`
 *   3. Если ref = `blockId` (без `.field`) → пробуем `liveValues[blockId]` (для
 *      ссылок на «основное value» блока — convention из `useAllBlockValuesFlat`).
 *
 * Не найдено → подставляется `0`, `unresolved += 1`.
 */
export function substituteAtRefs(
  formula: string,
  liveValues: Record<string, number | string | null> | undefined,
): { result: string; substituted: number; unresolved: number } {
  let substituted = 0;
  let unresolved = 0;
  const values = liveValues ?? {};
  const result = formula.replace(AT_REF_RE, (_match, ref: string) => {
    const direct = values[ref];
    let raw: number | string | null | undefined = direct;
    if (raw === undefined || raw === null) {
      raw = values[ref.toLowerCase()];
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      substituted += 1;
      return String(raw);
    }
    if (typeof raw === 'string') {
      const num = Number(raw.replace(',', '.'));
      if (Number.isFinite(num)) {
        substituted += 1;
        return String(num);
      }
    }
    unresolved += 1;
    return '0';
  });
  return { result, substituted, unresolved };
}

/** True если в формуле остался хотя бы один @-ref. */
export function containsAtRef(formula: string): boolean {
  AT_REF_RE.lastIndex = 0;
  return AT_REF_RE.test(formula);
}

/** True если строка похожа на формулу — начинается с `=`. */
export function isFormulaString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('=');
}
