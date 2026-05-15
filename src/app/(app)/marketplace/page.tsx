// PURPOSE: /marketplace — каталог всех блоков (browse-only).
// Создание/покупка пользовательских блоков — заглушки на будущее.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listAllBlocks } from '@/lib/blocks/registry';
import { MarketplaceClient, type MarketplaceBlock } from './marketplace-client';

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Дашборд',
  cashflow: 'Денежный поток',
  inbox: 'Входящие',
  'unit-economics-ozon': 'Юнит · Ozon',
  'unit-economics-ozon-multi': 'Юнит · Ozon мульти',
  'unit-economics-yandex': 'Юнит · Яндекс',
  'unit-economics-my-store': 'Мой магазин',
  '*': 'Любая страница',
};

function pageLabel(key: string): string {
  return PAGE_LABELS[key] ?? key;
}

export default async function MarketplacePage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  if (!session.tenantId) redirect('/onboarding');

  const blocks: MarketplaceBlock[] = listAllBlocks().map((b) => ({
    type: b.type,
    displayName: b.displayName,
    description: b.description,
    category: b.category,
    iconName: b.icon.displayName ?? 'Square',
    pages: b.pages.map(pageLabel),
    tags: b.tags ?? [],
    source: b.source ?? 'builtin',
    defaultSize: b.defaultSize,
    supportsDependencies: !!b.supportsDependencies,
  }));

  return <MarketplaceClient blocks={blocks} />;
}
