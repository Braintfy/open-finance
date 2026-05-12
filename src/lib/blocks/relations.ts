// PURPOSE: Shared relation detection for BlockGrid icons and relation overlay.
import type { BlockInstance } from './types';

export type BlockRelationEdge = {
  fromId: string;
  toId: string;
  label?: string;
  kind: 'dependency' | 'formula';
};

const FORMULA_REF_RE = /@([A-Za-z0-9_.:-]+)/g;

export function collectBlockRelationEdges(blocks: BlockInstance[], currentPageKey?: string): BlockRelationEdge[] {
  const blockIds = new Set(blocks.map((block) => block.id));
  const edges: BlockRelationEdge[] = [];
  const seen = new Set<string>();

  function addEdge(fromId: string | null, toId: string, label: string | undefined, kind: BlockRelationEdge['kind']) {
    if (!fromId || !blockIds.has(fromId) || !blockIds.has(toId) || fromId === toId) return;
    const key = `${kind}:${fromId}:${toId}:${label ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ fromId, toId, label, kind });
  }

  for (const block of blocks) {
    for (const source of block.dependencies?.sources ?? []) {
      if (!source.pageKey || source.pageKey === currentPageKey) {
        addEdge(source.blockId, block.id, block.dependencies?.aggregation, 'dependency');
      }
    }

    for (const ref of collectConfigRefs(block.config)) {
      addEdge(localBlockIdFromRef(ref, currentPageKey, blockIds), block.id, 'формула', 'formula');
    }
  }

  return edges;
}

export function collectBlockRelationIds(blocks: BlockInstance[], currentPageKey?: string): Set<string> {
  const blockIds = new Set(blocks.map((block) => block.id));
  const ids = new Set<string>();

  for (const edge of collectBlockRelationEdges(blocks, currentPageKey)) {
    ids.add(edge.fromId);
    ids.add(edge.toId);
  }

  for (const block of blocks) {
    const dependencySources = block.dependencies?.sources ?? [];
    if (dependencySources.length > 0) ids.add(block.id);
    for (const source of dependencySources) {
      if (blockIds.has(source.blockId)) ids.add(source.blockId);
    }

    const refs = collectConfigRefs(block.config);
    if (refs.length > 0) ids.add(block.id);
    for (const ref of refs) {
      const sourceId = localBlockIdFromRef(ref, currentPageKey, blockIds);
      if (sourceId) ids.add(sourceId);
    }
  }

  return ids;
}

function collectConfigRefs(config: BlockInstance['config']): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  function add(ref: string) {
    if (seen.has(ref)) return;
    seen.add(ref);
    refs.push(ref);
  }

  function scan(value: unknown, depth: number) {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      let match: RegExpExecArray | null;
      FORMULA_REF_RE.lastIndex = 0;
      while ((match = FORMULA_REF_RE.exec(value)) !== null) add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => scan(item, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      if (typeof objectValue.blockRefs === 'object' && objectValue.blockRefs !== null) {
        Object.keys(objectValue.blockRefs as Record<string, unknown>).forEach(add);
      }
      Object.entries(objectValue).forEach(([key, item]) => {
        if (key === 'moneyRefs') return;
        scan(item, depth + 1);
      });
    }
  }

  scan(config, 0);
  return refs;
}

function localBlockIdFromRef(ref: string, currentPageKey: string | undefined, blockIds: Set<string>): string | null {
  const colon = ref.lastIndexOf(':');
  if (colon >= 0) {
    const pageKey = ref.slice(0, colon);
    if (currentPageKey && pageKey !== currentPageKey) return null;
  }

  const source = colon >= 0 ? ref.slice(colon + 1) : ref;
  const dot = source.lastIndexOf('.');
  const blockId = dot >= 0 ? source.slice(0, dot) : source;
  return blockIds.has(blockId) ? blockId : null;
}
