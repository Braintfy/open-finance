// PURPOSE: Drizzle Kit config — миграции для Postgres + pgvector
import type { Config } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';

// drizzle-kit запускается вне Next.js, поэтому .env.local нужно подгрузить вручную
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

export default {
  schema: './src/lib/db/schema/*',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://openfinance_user:openfinance_local_dev@localhost:5433/openfinance_dev',
  },
  verbose: true,
  strict: true,
} satisfies Config;
