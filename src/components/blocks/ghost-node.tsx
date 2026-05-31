// PURPOSE: Призрачный узел React Flow — связанный блок из ДРУГОГО раздела.
// Полупрозрачная read-only карточка (иконка + название + бейдж раздела).
// Клик → переход на ту страницу. Не перетаскивается.
'use client';

import { useRouter } from 'next/navigation';
import { Box, ExternalLink } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { getBlockDef } from '@/lib/blocks/registry';
import { pageHref } from '@/lib/blocks/use-cross-page-relations';

export type GhostNodeData = {
  blockType: string;
  label: string;
  pageKey: string;
  pageLabel: string;
};

export type GhostFlowNode = Node<GhostNodeData, 'ghostNode'>;

export function GhostNode({ data }: NodeProps<GhostFlowNode>) {
  const router = useRouter();
  const def = getBlockDef(data.blockType);
  const Icon = resolveIcon(def?.iconName, Box);
  const href = pageHref(data.pageKey);
  const clickable = href !== '#';

  return (
    <div
      className={
        'ghost-node group relative w-[210px] rounded-xl border border-dashed border-slate-300 bg-white/70 shadow-sm ' +
        (clickable ? 'cursor-pointer hover:bg-white' : '')
      }
      title={clickable ? `Открыть «${data.pageLabel}»` : data.pageLabel}
      onClick={() => {
        if (clickable) router.push(href);
      }}
    >
      <Handle type="target" position={Position.Left} id="in" className="ghost-node-handle" />
      <Handle type="source" position={Position.Right} id="out" className="ghost-node-handle" />

      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600" title={data.label}>
          {data.label}
        </span>
        {clickable && <ExternalLink className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-slate-500" />}
      </div>
      <div className="flex items-center gap-1 border-t border-dashed border-slate-200 px-2.5 py-1">
        <span className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {data.pageLabel}
        </span>
      </div>
    </div>
  );
}

export const ghostNodeTypes = { ghostNode: GhostNode };
