// PURPOSE: /settings/ai — страница персональных AI-настроек пользователя.
// Позволяет подключить свои API ключи для DeepSeek/Yandex GPT/GigaChat/OpenAI.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AiSettingsClient } from './ai-settings-client';

export default async function AiSettingsPage() {
  const session = await auth();
  if (!session?.userId || !session.tenantId) redirect('/login');

  return <AiSettingsClient />;
}
