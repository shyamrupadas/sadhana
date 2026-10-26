import { createHash } from 'node:crypto'
import type { loadMigrations } from './migrate'

// Reviewed 001–006 from 259975c only affects public and installs uuid-ossp.
// Extend this list only after reviewing the entire prefix's SQL scope and extensions.
export const reviewedSqlPrefixes: Readonly<Record<string, string>> = {
  '006': '130a4c36d800ac386f6f2283a969daf09ddc22402afce565eba7faf3b236cfab',
  // 007 checks catalog metadata and removes only public's redundant indexes/UNIQUE.
  '007': '9346a8a45226f83b52f0e7c7461563cd34ddf565b2e126d467c11d9c55f074e5',
  // 008 validates and reconciles sleep in the current schema, using one temporary table.
  '008': 'a096d47f1cbaed3f91b58c97208b7f801982762ba92603b4b5f51078cfd81b3a',
  // 009 normalizes habits in the current schema and reconciles three temporary tables.
  '009': 'b120b82c22f03ded44256d9f111a74bb51c0dbf65f26770860a7058f9cbf3ce6',
}

export function requirePublicSqlScope(
  migrations: ReturnType<typeof loadMigrations>,
  to: string,
  reviewed: Readonly<Record<string, string>> = reviewedSqlPrefixes
): void {
  const prefix = migrations.filter(({ id }) => id <= to)
  const fingerprint = createHash('sha256')
    .update(prefix.map(({ id, checksum }) => `${id}:${checksum}`).join('\n'))
    .digest('hex')
  if (prefix.at(-1)?.id !== to || fingerprint !== reviewed[to]) {
    throw new Error('SQL prefix has no reviewed public scope')
  }
}
