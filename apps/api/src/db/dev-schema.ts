import { Client } from 'pg'
import type { Configuration } from '../config/environment'

export function publicDatabaseUrl(connectionString: string): string {
  // Only callers holding an independently validated URL may add this fixed SQL scope.
  const url = new URL(connectionString)
  url.searchParams.set('options', '-csearch_path=public')
  return url.toString()
}

export type PublicSchemaSession = {
  check(): Promise<void>
  reset(): Promise<void>
  close(): Promise<void>
}

// Follow both dependents and their internal/extension owners: a view's rewrite rule,
// for example, can make CASCADE remove the whole view in a different schema.
const externalDependencies = `
  WITH RECURSIVE doomed(classid, objid) AS (
    SELECT 'pg_namespace'::regclass::oid, oid FROM pg_namespace WHERE nspname = 'public'
    UNION
    SELECT
      CASE WHEN d.refclassid = t.classid AND d.refobjid = t.objid THEN d.classid ELSE d.refclassid END,
      CASE WHEN d.refclassid = t.classid AND d.refobjid = t.objid THEN d.objid ELSE d.refobjid END
    FROM doomed t JOIN pg_depend d ON
      (d.refclassid = t.classid AND d.refobjid = t.objid)
      OR (d.deptype IN ('i', 'e') AND d.classid = t.classid AND d.objid = t.objid)
  )
  SELECT EXISTS (
    SELECT 1 FROM doomed t
    CROSS JOIN LATERAL pg_identify_object(t.classid, t.objid, 0) identified
    LEFT JOIN pg_rewrite rw ON t.classid = 'pg_rewrite'::regclass AND rw.oid = t.objid
    LEFT JOIN pg_attrdef ad ON t.classid = 'pg_attrdef'::regclass AND ad.oid = t.objid
    LEFT JOIN pg_trigger tr ON t.classid = 'pg_trigger'::regclass AND tr.oid = t.objid
    LEFT JOIN pg_policy pol ON t.classid = 'pg_policy'::regclass AND pol.oid = t.objid
    LEFT JOIN pg_class parent ON parent.oid = COALESCE(rw.ev_class, ad.adrelid, tr.tgrelid, pol.polrelid)
    LEFT JOIN pg_namespace ns ON ns.oid = parent.relnamespace
    LEFT JOIN pg_extension ext ON t.classid = 'pg_extension'::regclass AND ext.oid = t.objid
    WHERE CASE
      WHEN t.classid = 'pg_namespace'::regclass THEN t.objid <> 'public'::regnamespace
      WHEN t.classid = 'pg_extension'::regclass THEN
        ext.extname <> 'uuid-ossp' OR ext.extnamespace <> 'public'::regnamespace
      ELSE COALESCE(identified.schema, ns.nspname, '') NOT IN ('public', 'pg_toast')
    END
  ) OR EXISTS (
    SELECT 1 FROM doomed t JOIN pg_depend d ON d.classid = t.classid AND d.objid = t.objid
    CROSS JOIN LATERAL pg_identify_object(d.refclassid, d.refobjid, 0) referenced
    WHERE referenced.schema IS NOT NULL
      AND referenced.schema NOT IN ('public', 'pg_catalog', 'pg_toast', 'information_schema')
  ) AS outside
`

export function openPublicSchema(config: Configuration): PublicSchemaSession {
  const client = new Client({
    connectionString: publicDatabaseUrl(config.MIGRATION_DATABASE_URL),
    connectionTimeoutMillis: 10_000,
  })
  async function check() {
    const rights = await client.query<{
      correct_target: boolean
      owns_schema: boolean
      can_create: boolean
      extension_available: boolean
      idle: boolean
    }>(
      `
      SELECT current_database() = $1 AND current_user = $2 AS correct_target,
        COALESCE((SELECT pg_has_role(current_user, nspowner, 'USAGE') FROM pg_namespace WHERE nspname = 'public'), true) AS owns_schema,
        has_database_privilege(current_database(), 'CREATE') AS can_create,
        EXISTS (SELECT 1 FROM pg_available_extension_versions v JOIN pg_available_extensions e ON e.name = v.name
                WHERE v.name = 'uuid-ossp' AND v.version = e.default_version AND (v.trusted OR NOT v.superuser)) AS extension_available,
        NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) AS idle
    `,
      [config.databaseTarget.database, config.databaseTarget.role]
    )
    const row = rights.rows[0]
    if (
      !row?.correct_target ||
      !row.owns_schema ||
      !row.can_create ||
      !row.extension_available ||
      !row.idle
    ) {
      throw new Error(
        'Public schema permissions, trusted uuid-ossp and stopped application sessions required'
      )
    }
    const extensions = await client.query(`
      SELECT extname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE NOT ((e.extname = 'plpgsql' AND n.nspname = 'pg_catalog')
                 OR (e.extname = 'uuid-ossp' AND n.nspname = 'public'))
    `)
    if (extensions.rows.length)
      throw new Error('Unsupported extension; public schema preserved')
    // An absent public schema has nothing to cascade to; it can be recovered as well.
    const schema = await client.query("SELECT to_regnamespace('public') AS namespace")
    if (schema.rows[0]?.namespace) {
      const dependencies = await client.query<{ outside: boolean }>(externalDependencies)
      if (dependencies.rows[0]?.outside !== false)
        throw new Error('Dependencies outside public; schema preserved')
    }
  }
  return {
    async check() {
      await client.connect()
      await client.query("SET statement_timeout = '30s'")
      await check()
    },
    async reset() {
      await client.query('BEGIN')
      try {
        await client.query("SET LOCAL lock_timeout = '10s'")
        // Repeat the inventory/permission check in the cleanup transaction.
        await check()
        await client.query('DROP SCHEMA IF EXISTS public CASCADE')
        await client.query('CREATE SCHEMA public AUTHORIZATION CURRENT_USER')
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    },
    async close() {
      await client.end()
    },
  }
}
