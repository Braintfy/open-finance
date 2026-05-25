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
};

export type SourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
};
