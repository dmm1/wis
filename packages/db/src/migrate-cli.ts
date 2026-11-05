import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set');
await runMigrations(url);
console.log('Migrations applied.');
