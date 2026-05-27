// PURPOSE: Универсальный JSON-сериализатор/парсер блока. Работает для любого
// BlockDef через паблик-схему BlockInstance. Используется как fallback в
// registry, и как «лучший» формат для переносимости (полная копия блока).

import { z } from 'zod';
import type { BlockDef, BlockInstance } from '../types';
import { APP_VERSION } from '@/lib/version';
import {
  BLOCK_EXPORT_SCHEMA,
  type BlockExportPayload,
  type BlockImportExportAdapter,
  type ImportPreview,
  type ImportStat,
} from './types';
import { blockHasUserData, scrubCrossRefs } from './refs-scrubber';

const PayloadSchema = z.object({
  $schema: z.literal(BLOCK_EXPORT_SCHEMA),
  exportedAt: z.string(),
  appVersion: z.string(),
  blockType: z.string(),
  displayName: z.string().default(''),
  size: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  config: z.record(z.string(), z.unknown()).default({}),
  appearance: z
    .object({
      title: z.string().optional(),
      borderColor: z.string().optional(),
      accentColor: z.string().optional(),
      icon: z.string().optional(),
    })
    .optional(),
  dependencies: z
    .object({
      sources: z
        .array(
          z.object({
            blockId: z.string(),
            pageKey: z.string().optional(),
            field: z.string().optional(),
            label: z.string().optional(),
          }),
        )
        .default([]),
      aggregation: z.string(),
      formulaExpression: z.string().optional(),
    })
    .passthrough()
    .optional(),
  aiPromptSupplement: z.string().optional(),
});

/** Сериализация блока в JSON-payload (без id, x, y). */
export function buildJsonPayload(instance: BlockInstance, def: BlockDef): BlockExportPayload {
  const payload: BlockExportPayload = {
    $schema: BLOCK_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    blockType: instance.type,
    displayName: def.displayName,
    size: { w: instance.w, h: instance.h },
    config: (instance.config ?? {}) as Record<string, unknown>,
  };
  if (instance.appearance && Object.keys(instance.appearance).length > 0) {
    payload.appearance = { ...instance.appearance };
  }
  if (instance.dependencies && (instance.dependencies.sources?.length ?? 0) >= 0) {
    payload.dependencies = { ...instance.dependencies };
  }
  if (instance.aiPromptSupplement && instance.aiPromptSupplement.trim().length > 0) {
    payload.aiPromptSupplement = instance.aiPromptSupplement;
  }
  return payload;
}

/** Парсинг JSON-строки + zod-валидация. */
export function parseJsonPayload(text: string): { ok: true; payload: BlockExportPayload } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Не удалось распарсить JSON: ${(err as Error).message}` };
  }
  const result = PayloadSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: `Неверный формат файла: ${issue?.path.join('.') || 'root'} — ${issue?.message ?? 'unknown'}`,
    };
  }
  return { ok: true, payload: result.data as BlockExportPayload };
}

/** Построить preview для импорта JSON-payload в данный блок. */
export function buildJsonPreview(payload: BlockExportPayload, current: BlockInstance): ImportPreview {
  if (payload.blockType !== current.type) {
    return {
      ok: false,
      error: `Тип файла (${payload.blockType}) не совпадает с типом блока (${current.type}). Импорт невозможен.`,
    };
  }

  const scrub = scrubCrossRefs(payload.config, payload.dependencies);

  // Статистика
  const stats: ImportStat[] = [
    { label: 'Размер', value: `${payload.size.w}×${payload.size.h}` },
  ];
  const cfg = scrub.config as Record<string, unknown>;
  if (Array.isArray(cfg.rows)) {
    stats.push({ label: 'Строк', value: String((cfg.rows as unknown[]).length) });
  }
  if (Array.isArray(cfg.columns)) {
    stats.push({ label: 'Колонок', value: String((cfg.columns as unknown[]).length) });
  }
  if (Array.isArray(cfg.cells)) {
    const cells = cfg.cells as unknown[];
    if (cells.length > 0 && Array.isArray(cells[0])) {
      // 2D — sheet
      const rows = cells.length;
      const cols = (cells[0] as unknown[]).length;
      stats.push({ label: 'Ячеек', value: `${rows}×${cols}` });
    } else {
      stats.push({ label: 'Ячеек', value: String(cells.length) });
    }
  }
  if (Array.isArray(cfg.headerCells)) {
    stats.push({ label: 'Header', value: String((cfg.headerCells as unknown[]).length) });
  }
  if (payload.aiPromptSupplement) {
    stats.push({ label: 'AI-промпт', value: 'есть' });
  }
  if (payload.appearance && Object.values(payload.appearance).some((v) => v)) {
    stats.push({ label: 'Внешний вид', value: 'есть' });
  }

  // patch для перезаписи: всё что есть в payload + scrubbed
  const patch: Partial<BlockInstance> = {
    w: payload.size.w,
    h: payload.size.h,
    config: scrub.config,
  };
  if (payload.appearance) patch.appearance = payload.appearance;
  // dependencies: всегда явно (даже если undefined — чтобы старые dependencies снесло)
  patch.dependencies = scrub.dependencies;
  if (payload.aiPromptSupplement !== undefined) {
    patch.aiPromptSupplement = payload.aiPromptSupplement;
  }

  return {
    ok: true,
    stats,
    scrubbedRefs: scrub.scrubbed,
    hasExistingData: blockHasUserData(current),
    patch,
    canMerge: false, // универсальный JSON не поддерживает merge
  };
}

/** Универсальный JSON-only адаптер (fallback для всех типов блоков). */
export function createJsonOnlyAdapter(type: string): BlockImportExportAdapter {
  return {
    type,
    supportsXlsx: false,
    exportJson: buildJsonPayload,
    importJson: buildJsonPreview,
  };
}
