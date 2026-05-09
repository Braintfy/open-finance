// PURPOSE: Drizzle client (Postgres) — основная точка работы с БД
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/lib/env';

// Один shared connection pool на процесс
const queryClient = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  prepare: false,
});

export const db = drizzle(queryClient, { schema, logger: env.NODE_ENV === 'development' });

export type DB = typeof db;
export { schema };
