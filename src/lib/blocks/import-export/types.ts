// PURPOSE: Universal Block Import/Export — types shared by JSON-adapter,
// XLSX-adapters and UI. См. план blocks-import-export-65ff41.md.

import type { BlockDef, BlockInstance } from '../types';

/** Версия JSON-схемы экспорта. Bump при breaking changes. */
export const BLOCK_EXPORT_SCHEMA = 'open-finance.block-export.v1' as const;

/** Структура JSON-файла блока. ID не сохраняется — генерируется новый при импорте. */
export type BlockExportPayload = {
  $schema: typeof BLOCK_EXPORT_SCHEMA;
  exportedAt: string; // ISO timestamp
  appVersion: string; // APP_VERSION
  blockType: string; // BlockInstance.type
  displayName: string; // BlockDef.displayName (для удобства)
  size: { w: number; h: number };
  config: Record<string, unknown>;
  appearance?: BlockInstance['appearance'];
  dependencies?: BlockInstance['dependencies'];
  aiPromptSupplement?: string;
};

/** Описание зачищенной cross-ref в превью. */
export type ScrubbedRef = {
  kind: 'dependencies' | 'blockRefs' | 'binding' | 'formula-ref' | 'cell-binding';
  description: string;
};

/** Краткий показатель для UI (отображается как pill). */
export type ImportStat = {
  label: string;
  value: string;
};

/** Результат разбора файла + plan применения. */
export type ImportPreview =
  | {
      ok: false;
      error: string;
    }
  | {
      ok: true;
      /** Краткие показатели импортируемых данных. */
      stats: ImportStat[];
      /** Какие cross-refs будут очищены/потеряны. */
      scrubbedRefs: ScrubbedRef[];
      /** Уже есть данные в текущем блоке (показываем красное предупреждение). */
      hasExistingData: boolean;
      /** Patch для overwrite-режима. */
      patch: Partial<BlockInstance>;
      /** Поддерживается merge-режим (для табличных блоков). */
      canMerge: boolean;
      /** Patch для merge-режима. undefined если canMerge=false. */
      mergePatch?: Partial<BlockInstance>;
    };

/**
 * Опции экспорта. `liveValues` — снапшот live-store значений
 * (`{ 'blockId' | 'blockId.field' → value }`), необходим для адаптеров,
 * которые подставляют @-references в формулах перед записью в XLSX
 * (Excel не понимает `@blockId.field`). Если не передан — @-refs
 * становятся `0`.
 */
export type ExportXlsxOptions = {
  liveValues?: Record<string, number | string | null>;
};

/**
 * Адаптер импорта/экспорта блока. Один на тип блока.
 *
 * - JSON-методы обязательны (универсальный JSON-адаптер ставится по умолчанию).
 * - XLSX-методы опциональны (только для блоков с пользовательскими данными).
 *
 * Адаптеры НЕ должны напрямую вызывать UI-state — только возвращать `patch`,
 * который потом применяется через `BlockSettingsDialog.onChange()`.
 */
export type BlockImportExportAdapter = {
  type: string;
  supportsXlsx: boolean;
  exportJson(instance: BlockInstance, def: BlockDef): BlockExportPayload;
  importJson(payload: BlockExportPayload, current: BlockInstance): ImportPreview;
  exportXlsx?(instance: BlockInstance, def: BlockDef, opts?: ExportXlsxOptions): Uint8Array;
  importXlsx?(buffer: ArrayBuffer, current: BlockInstance): ImportPreview;
};

/** Имя ключей, под которыми хранятся cross-refs в config. */
export const SCRUBBABLE_FIELDS = [
  'sourceBinding',
  'defaultSourceBinding',
  'sourceBindingOverride',
  'blockRefs',
  'moneyRefs',
] as const;
