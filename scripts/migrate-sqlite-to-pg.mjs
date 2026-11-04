/**
 * One-time copy from the old local SQLite file into PostgreSQL.
 *
 *   npm i -D better-sqlite3
 *   DATABASE_URL=postgres://arvs:arvs@localhost:5432/arvs node scripts/migrate-sqlite-to-pg.mjs
 *
 * Optional: SQLITE_PATH=data/app.db (default)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { databaseUrl } from '../src/db.js';

const sqlitePath = path.resolve(process.env.SQLITE_PATH || 'data/app.db');
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.error('Install better-sqlite3 once to read the old file: npm i -D better-sqlite3');
  process.exit(1);
}

const url = databaseUrl();
if (!url) {
  console.error('Set DATABASE_URL (or DB_HOST + DB_NAME + DB_USER + DB_PASSWORD).');
  process.exit(1);
}

const TABLES = [
  'settings',
  'admins',
  'mandals',
  'committees',
  'members',
  'sections',
  'people',
  'programs',
  'events',
  'posts',
  'post_likes',
  'comments',
  'signatures',
  'certificate_log',
  'broadcasts',
  'broadcast_recipients',
  'donations',
  'meetings',
  'meeting_files',
];

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new pg.Pool({ connectionString: url });

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function copyTable(client, table) {
  let rows;
  try {
    rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  } catch (err) {
    if (String(err.message).includes('no such table')) {
      console.log(`skip missing sqlite table ${table}`);
      return;
    }
    throw err;
  }
  if (!rows.length) {
    console.log(`${table}: 0 rows`);
    return;
  }
  const cols = Object.keys(rows[0]);
  const colSql = cols.map(quoteIdent).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  let n = 0;
  for (const row of rows) {
    await client.query(
      sql,
      cols.map((c) => row[c])
    );
    n += 1;
  }
  try {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1), true)`,
      [table]
    );
  } catch {
    /* settings / post_likes have no id identity */
  }
  console.log(`${table}: ${n} rows`);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SET session_replication_role = replica');
  for (const table of TABLES) await copyTable(client, table);
  await client.query('SET session_replication_role = origin');
  await client.query('COMMIT');
  console.log('Migration finished.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
  process.exit(process.exitCode || 0);
}
