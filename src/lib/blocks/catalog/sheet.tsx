// PURPOSE: Sheet block — простая Excel-like таблица с редактируемыми ячейками
'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { Table2 } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const SheetConfig = z.object({
  title: z.string().default('Таблица'),
  rows: z.number().int().min(1).max(200).default(10),
  cols: z.number().int().min(1).max(26).default(5),
  // Двумерный массив строк (плоско по rows): cells[row][col]
  cells: z.array(z.array(z.string())).optional(),
});

type SheetCfg = z.infer<typeof SheetConfig>;

function emptyCells(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
}

function ensureShape(cells: string[][] | undefined, rows: number, cols: number): string[][] {
  const grid = cells ?? [];
  const result: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(grid[r]?.[c] ?? '');
    }
    result.push(row);
  }
  return result;
}

function colLabel(i: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function RenderSheet({ instance, onConfigChange }: BlockRenderProps) {
  const cfg = SheetConfig.parse(instance.config ?? {});
  const [cells, setCells] = useState<string[][]>(() =>
    ensureShape(cfg.cells, cfg.rows, cfg.cols)
  );

  // Синхронизация при внешнем изменении размеров
  useEffect(() => {
    setCells((prev) => ensureShape(prev, cfg.rows, cfg.cols));
  }, [cfg.rows, cfg.cols]);

  function update(r: number, c: number, value: string) {
    setCells((prev) => {
      const next = prev.map((row, ri) =>
        ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row
      );
      onConfigChange?.({ ...cfg, cells: next });
      return next;
    });
  }

  const headerStyle: CSSProperties = {
    background: 'var(--muted, #f4f4f5)',
    fontWeight: 500,
    fontSize: '0.7rem',
    color: 'var(--muted-foreground, #71717a)',
  };

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{instance.appearance?.title ?? cfg.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-10 w-10 border" style={headerStyle}></th>
              {Array.from({ length: cfg.cols }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 min-w-[80px] border px-2 py-1 text-left"
                  style={headerStyle}
                >
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, r) => (
              <tr key={r}>
                <td
                  className="sticky left-0 w-10 border text-center"
                  style={headerStyle}
                >
                  {r + 1}
                </td>
                {row.map((value, c) => (
                  <td key={c} className="border p-0">
                    <Input
                      value={value}
                      onChange={(e) => update(r, c, e.target.value)}
                      className="h-8 rounded-none border-0 px-2 text-sm focus-visible:ring-1 focus-visible:ring-inset"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function SheetSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const cfg = SheetConfig.parse(config ?? {});
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Строк: <span className="tabular-nums">{cfg.rows}</span>
        </label>
        <input
          type="range"
          min={1}
          max={100}
          value={cfg.rows}
          onChange={(e) => onChange({ ...cfg, rows: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Колонок: <span className="tabular-nums">{cfg.cols}</span>
        </label>
        <input
          type="range"
          min={1}
          max={26}
          value={cfg.cols}
          onChange={(e) => onChange({ ...cfg, cols: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Существующие данные сохраняются. При уменьшении — обрезаются, при увеличении —
        дополняются пустыми ячейками.
      </p>
    </div>
  );
}

export const SheetBlock: BlockDef = {
  type: 'sheet',
  displayName: 'Таблица (Excel-like)',
  description: 'Произвольная таблица с редактируемыми ячейками',
  category: 'tables',
  icon: Table2,
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 200, h: 120 },
  pages: ['*'],
  configSchema: SheetConfig,
  defaultConfig: () => ({
    title: 'Таблица',
    rows: 10,
    cols: 5,
    cells: emptyCells(10, 5),
  }),
  SettingsForm: SheetSettings,
  Render: RenderSheet,
};
