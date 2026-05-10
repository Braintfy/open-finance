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
  AI_DEFAULT_PROVIDER: z
    .enum(['anthropic', 'openai', 'yandex', 'ollama', 'mock'])
    .default('mock'),

  // Ollama (локальная модель в dev)
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_DEFAULT_MODEL: z.string().default('qwen2.5:7b'),
  AI_MOCK_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // VPN-прокси
  AI_PROXY_URL: z.string().url().optional().or(z.literal('')),
  AI_PROXY_USERNAME: z.string().optional(),
  AI_PROXY_PASSWORD: z.string().optional(),

  // Storage (S3-совместимое)
  S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Биллинг
  TKASSA_TERMINAL_KEY: z.string().optional(),
  TKASSA_TERMINAL_PASSWORD: z.string().optional(),
  CLOUDPAYMENTS_PUBLIC_ID: z.string().optional(),
  CLOUDPAYMENTS_API_PASSWORD: z.string().optional(),

  // Sentry (мониторинг)
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),

  // Feature flags
  FEATURE_OPEN_REGISTRATION: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  FEATURE_ONBOARDING_WIZARD: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  FEATURE_BILLING_MOCK: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  FEATURE_DEFAULT_PLAN: z
    .enum(['free', 'trial', 'pro', 'business'])
    .default('trial'),

  // Auth
  AUTH_DRIVER: z.enum(['v4', 'v5']).default('v5'),
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
  AI_DEFAULT_PROVIDER: process.env.AI_DEFAULT_PROVIDER,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_DEFAULT_MODEL: process.env.OLLAMA_DEFAULT_MODEL,
  AI_MOCK_ENABLED: process.env.AI_MOCK_ENABLED,
  AI_PROXY_URL: process.env.AI_PROXY_URL,
  AI_PROXY_USERNAME: process.env.AI_PROXY_USERNAME,
  AI_PROXY_PASSWORD: process.env.AI_PROXY_PASSWORD,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_REGION: process.env.S3_REGION,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TKASSA_TERMINAL_KEY: process.env.TKASSA_TERMINAL_KEY,
  TKASSA_TERMINAL_PASSWORD: process.env.TKASSA_TERMINAL_PASSWORD,
  CLOUDPAYMENTS_PUBLIC_ID: process.env.CLOUDPAYMENTS_PUBLIC_ID,
  CLOUDPAYMENTS_API_PASSWORD: process.env.CLOUDPAYMENTS_API_PASSWORD,
  SENTRY_DSN: process.env.SENTRY_DSN,
  FEATURE_OPEN_REGISTRATION: process.env.FEATURE_OPEN_REGISTRATION,
  FEATURE_ONBOARDING_WIZARD: process.env.FEATURE_ONBOARDING_WIZARD,
  FEATURE_BILLING_MOCK: process.env.FEATURE_BILLING_MOCK,
  FEATURE_DEFAULT_PLAN: process.env.FEATURE_DEFAULT_PLAN,
  AUTH_DRIVER: process.env.AUTH_DRIVER,
});

export type Env = z.infer<typeof envSchema>;
