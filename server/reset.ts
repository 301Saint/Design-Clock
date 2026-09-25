import { rmSync } from 'node:fs';
import { DB_PATH } from './db.ts';

// Deletes the local database so the next start creates (and seeds) a fresh one.
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
console.log(`Removed ${DB_PATH}. A fresh, empty database is created on next start (npm run dev adds sample jobs).`);
