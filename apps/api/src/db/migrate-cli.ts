import { createPgDb } from './db';
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const db = createPgDb(url);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await db.close();
}
