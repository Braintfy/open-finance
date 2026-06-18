// PURPOSE: Базовый скелет-плейсхолдер — пульсирующий блок, theme-aware через bg-muted.
// Server-safe (без хуков/'use client'); animate-pulse — core-утилита Tailwind.
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
