// PURPOSE: Статический скелет страницы-BlockGrid для route-level loading.tsx.
// Рендерится в <main> пока серверный RSC страницы await'ит БД → навигация
// перестаёт «зависать» на старом экране. Server-safe (без хуков/'use client').
//
// Это best-effort оболочка: react-grid-layout ещё не смонтирован, поэтому точного
// pixel-match с финальной раскладкой нет — небольшой reflow на гидрации ожидаем
// и нормален (это переход загрузка→контент). Нулевой shift гарантируем только для
// per-block overlay (BlockSkeleton внутри уже отмеренной ячейки).
import { Skeleton } from '@/components/ui/skeleton';

function Card({ className }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-border/60 bg-card p-3 ${className ?? ''}`}>
      <div className="flex h-full flex-col gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-auto h-10 w-full" />
      </div>
    </div>
  );
}

export function BlockGridSkeleton({ count = 6 }: { count?: number }) {
  // Разнокалиберные карточки (col-span/row-span) — грубо повторяют дашборд.
  const spans = [
    'sm:col-span-1 min-h-[120px]',
    'sm:col-span-1 min-h-[120px]',
    'sm:col-span-1 min-h-[120px]',
    'sm:col-span-2 min-h-[200px]',
    'sm:col-span-1 min-h-[200px]',
    'sm:col-span-3 min-h-[160px]',
  ];
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      {/* Шапка раздела */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      {/* Сетка блоков */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className={spans[i % spans.length]} />
        ))}
      </div>
    </div>
  );
}
