import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
export * from './schema.js';
export function createDatabase(url: string) {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
