// PURPOSE: Type-safe доступ к переменным окружения
// При старте валидируется что все required env есть
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  // Auth
  NEXTAUTH_SECRET: z.string().min(32).optional(),
  NEXTAUTH_URL: z.string().url().optional(),

  // AI providers (BYOK или server-side)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  YANDEX_API_KEY: z.string().optional(),

  // Storage (S3-совместимое)
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Биллинг
  TKASSA_TERMINAL_KEY: z.string().optional(),
  TKASSA_TERMINAL_PASSWORD: z.string().optional(),
  CLOUDPAYMENTS_PUBLIC_ID: z.string().optional(),
  CLOUDPAYMENTS_API_PASSWORD: z.string().optional(),

  // Sentry (мониторинг)
  SENTRY_DSN: z.string().url().optional(),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  YANDEX_API_KEY: process.env.YANDEX_API_KEY,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TKASSA_TERMINAL_KEY: process.env.TKASSA_TERMINAL_KEY,
  TKASSA_TERMINAL_PASSWORD: process.env.TKASSA_TERMINAL_PASSWORD,
  CLOUDPAYMENTS_PUBLIC_ID: process.env.CLOUDPAYMENTS_PUBLIC_ID,
  CLOUDPAYMENTS_API_PASSWORD: process.env.CLOUDPAYMENTS_API_PASSWORD,
  SENTRY_DSN: process.env.SENTRY_DSN,
});

export type Env = z.infer<typeof envSchema>;
