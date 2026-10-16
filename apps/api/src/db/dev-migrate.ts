import { devDatabaseMain } from './dev-database'

void devDatabaseMain(['migrate', ...process.argv.slice(2)])
