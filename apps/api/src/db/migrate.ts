import { config } from 'dotenv'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { Pool } from 'pg'

config()

const runMigrations = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const migrationsDir = join(__dirname, '..', '..', 'src', 'db', 'migrations')

    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const file of migrationFiles) {
      const migrationPath = join(migrationsDir, file)
      const migrationSQL = readFileSync(migrationPath, 'utf-8')

      console.log(`Running migration: ${file}`)
      await pool.query(migrationSQL)
      console.log(`Migration ${file} completed successfully`)
    }

    console.log('All migrations completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigrations()
