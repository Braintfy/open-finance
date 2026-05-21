// PURPOSE: Router для выбора Vision-провайдера. По умолчанию читает из
// env (VISION_PROVIDER), но может также принимать override от tenant settings.
// Поддерживаемые id: claude / openai / yandex / tesseract / mock.

import type { VisionProvider, VisionProviderId } from './types';
import { mockVisionProvider } from './providers/mock';
import { claudeVisionProvider } from './providers/claude';
import { openaiVisionProvider } from './providers/openai';
import { yandexVisionProvider } from './providers/yandex';
import { tesseractVisionProvider } from './providers/tesseract';

const PROVIDERS: Record<VisionProviderId, VisionProvider> = {
  mock: mockVisionProvider,
  claude: claudeVisionProvider,
  openai: openaiVisionProvider,
  yandex: yandexVisionProvider,
  tesseract: tesseractVisionProvider,
};

export const ALL_VISION_PROVIDERS: VisionProvider[] = Object.values(PROVIDERS);

function isValidId(s: string): s is VisionProviderId {
  return ['mock', 'claude', 'openai', 'yandex', 'tesseract'].includes(s);
}

/**
 * Выбирает провайдера по приоритету:
 *   1. явный `override` (например, query param)
 *   2. tenant settings (TODO когда добавим колонку)
 *   3. env VISION_PROVIDER
 *   4. dev fallback: mock (если no env)
 *   5. prod fallback: yandex (если YANDEX_FOLDER_ID есть) → openai → claude
 */
export function getVisionProvider(opts?: {
  override?: string;
  tenantPreference?: string | null;
}): VisionProvider {
  const candidates: string[] = [];
  if (opts?.override) candidates.push(opts.override);
  if (opts?.tenantPreference) candidates.push(opts.tenantPreference);
  if (process.env.VISION_PROVIDER) candidates.push(process.env.VISION_PROVIDER);

  for (const c of candidates) {
    if (isValidId(c)) return PROVIDERS[c];
  }

  // Auto fallback по доступным env-ключам
  if (process.env.ANTHROPIC_API_KEY) return PROVIDERS.claude;
  if (process.env.OPENAI_API_KEY) return PROVIDERS.openai;
  if (process.env.YANDEX_FOLDER_ID && (process.env.YANDEX_IAM_TOKEN || process.env.YANDEX_API_KEY))
    return PROVIDERS.yandex;
  return PROVIDERS.mock;
}

/**
 * Возвращает список доступных провайдеров (с указанием доступности env-ключей).
 * Для UI выбора в /admin/ai.
 */
export function listVisionProviders(): Array<{
  id: VisionProviderId;
  label: string;
  available: boolean;
  reason?: string;
}> {
  return [
    {
      id: 'claude',
      label: claudeVisionProvider.label,
      available: !!process.env.ANTHROPIC_API_KEY,
      reason: process.env.ANTHROPIC_API_KEY ? undefined : 'Нет ANTHROPIC_API_KEY',
    },
    {
      id: 'openai',
      label: openaiVisionProvider.label,
      available: !!process.env.OPENAI_API_KEY,
      reason: process.env.OPENAI_API_KEY ? undefined : 'Нет OPENAI_API_KEY',
    },
    {
      id: 'yandex',
      label: yandexVisionProvider.label,
      available:
        !!process.env.YANDEX_FOLDER_ID &&
        !!(process.env.YANDEX_IAM_TOKEN || process.env.YANDEX_API_KEY),
      reason:
        process.env.YANDEX_FOLDER_ID && (process.env.YANDEX_IAM_TOKEN || process.env.YANDEX_API_KEY)
          ? undefined
          : 'Нужны YANDEX_FOLDER_ID + (YANDEX_IAM_TOKEN или YANDEX_API_KEY)',
    },
    {
      id: 'tesseract',
      label: tesseractVisionProvider.label,
      available: true,
      reason: 'tesseract.js устанавливается отдельно (pnpm add tesseract.js)',
    },
    {
      id: 'mock',
      label: mockVisionProvider.label,
      available: true,
      reason: 'Для тестов и разработки',
    },
  ];
}
