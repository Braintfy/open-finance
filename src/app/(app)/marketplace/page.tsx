// PURPOSE: /marketplace — Маркет блоков (browse-only).
// Server-Component делает ТОЛЬКО auth-проверку. Список блоков MarketplaceClient
// собирает сам на клиенте — иначе RSC-граница превращает BlockDef-объекты из
// `'use client'` catalog-файлов в opaque client-references (поля становятся
// undefined, см. MEMORY.md «Грабли · RSC + 'use client' экспорт-объекты»).
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { MarketplaceClient } from './marketplace-client';

export default async function MarketplacePage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  if (!session.tenantId) redirect('/onboarding');

  return <MarketplaceClient />;
}
