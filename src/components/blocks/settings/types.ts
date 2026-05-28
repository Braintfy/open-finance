// PURPOSE: Shared types for source block picker and field label utilities.
// Used by SourceBlockPicker, BlockReferencePicker, excel-cell.tsx, sheet.tsx.

export type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
  /** 'Ячейки' for per-cell fields from custom.data blocks */
  group?: string;
};

export type SourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: SourceField[];
  /**
   * Human-readable instance label from server: includes period + page context.
   * Example: «Ozon · аналитика · 30 дней — Аналитика Ozon».
   * Present for cross-page blocks from /api/blocks/sources, absent for live blocks.
   */
  instanceLabel?: string;
  /**
   * Period key for the period badge in the picker (e.g. '30d', '7d', 'mtd').
   * Live blocks override this via liveValues[blockId.__periodKey].
   * Cross-page blocks get it from the server via /api/blocks/sources.
   */
  periodKey?: string | null;
};

export type SourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
};
