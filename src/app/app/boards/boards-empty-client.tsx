// PURPOSE: Пустое состояние /boards — предложить создать первую доску
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BoardsEmptyClient() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Моя доска' }),
      });
      const data = await res.json();
      if (data.ok && data.board) {
        router.push(`/app/boards/${data.board.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Мои доски</h1>
          <p className="text-xs text-muted-foreground">
            Персональные рабочие пространства с блоками
          </p>
        </div>
      </div>

      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/30 p-10 text-center">
        <LayoutGrid className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <div className="mb-1 text-sm font-semibold">Нет досок</div>
        <p className="mb-4 max-w-sm text-xs text-muted-foreground">
          Создайте первую доску — чистое рабочее пространство, где можно собирать
          блоки с данными по проекту, клиенту или задаче.
        </p>
        <Button size="sm" onClick={handleCreate} disabled={creating}>
          <Plus /> {creating ? 'Создаём…' : 'Создать доску'}
        </Button>
      </div>
    </div>
  );
}
