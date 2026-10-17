import { createHash } from 'node:crypto'
import type { loadMigrations } from './migrate'

// Reviewed 001–006 from 259975c only affects public and installs uuid-ossp.
// Extend this list only after reviewing the entire prefix's SQL scope and extensions.
export const reviewedSqlPrefixes: Readonly<Record<string, string>> = {
  '006': '130a4c36d800ac386f6f2283a969daf09ddc22402afce565eba7faf3b236cfab',
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
