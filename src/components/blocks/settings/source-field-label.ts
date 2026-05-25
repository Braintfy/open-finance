// PURPOSE: Shared utilities for source field labeling and value preview formatting.
// Single source of truth for sourceFieldLabel / previewSourceValue / moneyFieldSet /
// cellFieldSet / mergeLiveFields — imported by SourceBlockPicker, BlockReferencePicker,
// excel-cell.tsx, sheet.tsx instead of each duplicating the logic.
import type { SourceField, SourceBlock } from './types';

/** Human-readable fallback labels for common published field keys. */
export function sourceFieldLabel(field: string): string {
  if (field === 'value') return 'Значение';
  if (field === 'count') return 'Количество';
  if (field === 'sum') return 'Сумма';
  if (field === 'label') return 'Название';
  if (field === 'raw') return 'Формула';
  return field;
}

function formatKopecksValue(kopecks: number, showKopecks: boolean): string {
  const rubles = kopecks / 100;
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: showKopecks ? 2 : 0,
    maximumFractionDigits: showKopecks ? 2 : 0,
  }).format(rubles);
}

/** Format a source field value for display in pickers. */
export function previewSourceValue(field: SourceField, showKopecks: boolean): string {
  if (field.value === null || field.value === undefined) return '—';
  if (field.format === 'money' && typeof field.value === 'number')
    return formatKopecksValue(field.value, showKopecks);
  return String(field.value).slice(0, 16);
}

/** Read __money marker from live values to get the set of money field names. */
export function moneyFieldSet(
  blockId: string,
  values: Record<string, number | string | null>,
): Set<string> {
  const raw = values[`${blockId}.__money`];
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
  );
}

/** Read __cellFields marker to identify per-cell (rowId.colId) published fields. */
export function cellFieldSet(
  blockId: string,
  values: Record<string, number | string | null>,
): Set<string> {
  const raw = values[`${blockId}.__cellFields`];
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
  );
}

/**
 * Merge live field values into a SourceBlock, updating labels, values and formats.
 * Used when API-provided SourcePage data is enriched by the reactive live store.
 */
export function mergeLiveFields(
  block: SourceBlock,
  liveFields: string[] | undefined,
  liveValues: Record<string, number | string | null>,
  liveLabels?: Record<string, string>,
): SourceBlock {
  if (!liveFields) return block;
  const moneyFields = moneyFieldSet(block.blockId, liveValues);
  const cellFields = cellFieldSet(block.blockId, liveValues);
  const byName = new Map(block.fields.map((field) => [field.name, field]));
  liveFields.forEach((name) => {
    const key = name === 'value' ? block.blockId : `${block.blockId}.${name}`;
    const current = byName.get(name);
    byName.set(name, {
      name,
      label: liveLabels?.[name] ?? current?.label ?? sourceFieldLabel(name),
      value: liveValues[key] ?? current?.value ?? null,
      format: moneyFields.has(name) ? ('money' as const) : current?.format,
      group: current?.group ?? (cellFields.has(name) ? 'Ячейки' : undefined),
    });
  });
  return { ...block, fields: Array.from(byName.values()) };
}

/** Heuristic: is this source field a money value? */
export function sourceFieldIsMoney(block: SourceBlock, field: SourceField): boolean {
  if (field.format) return field.format === 'money';
  if (['KPI', 'Кэшфлоу', 'Данные', 'Вычисления'].includes(block.category)) return true;
  return field.name === 'value';
}
