// PURPOSE: Drizzle Kit config — миграции для Postgres + pgvector
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema/*',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://openfinance:openfinance@localhost:5432/openfinance',
  },
  verbose: true,
  strict: true,
} satisfies Config;
