import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, UPLOAD_DIR, PRIVATE_DIR } from './config.js';

for (const dir of [DATA_DIR, UPLOAD_DIR, PRIVATE_DIR]) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'subadmin',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS mandals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS committees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  member_no TEXT UNIQUE,
  application_no TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  category TEXT NOT NULL DEFAULT 'sadasya',
  designation TEXT,
  salutation TEXT,
  name TEXT NOT NULL,
  name_en TEXT,
  father_name TEXT,
  gender TEXT,
  dob TEXT,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  pincode TEXT,
  native_place TEXT,
  gotra TEXT,
  occupation TEXT,
  education TEXT,
  mandal_id INTEGER REFERENCES mandals(id) ON DELETE SET NULL,
  committee_id INTEGER REFERENCES committees(id) ON DELETE SET NULL,
  photo TEXT,
  signature TEXT,
  show_in_directory INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  admin_notes TEXT,
  reject_reason TEXT,
  cert_serial INTEGER,
  cert_printed_at TEXT,
  cert_print_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status, category);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'custom',
  nav_label TEXT,
  title TEXT,
  subtitle TEXT,
  body TEXT,
  body2 TEXT,
  image TEXT,
  layout TEXT NOT NULL DEFAULT 'image-right',
  show_on_home INTEGER NOT NULL DEFAULT 1,
  has_page INTEGER NOT NULL DEFAULT 0,
  show_in_nav INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL DEFAULT 'leader',
  name TEXT NOT NULL,
  designation TEXT,
  place TEXT,
  bio TEXT,
  photo TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  icon TEXT,
  summary TEXT,
  body TEXT,
  image TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT,
  event_time TEXT,
  location TEXT,
  summary TEXT,
  body TEXT,
  image TEXT,
  gallery TEXT NOT NULL DEFAULT '[]',
  visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT,
  body TEXT NOT NULL,
  image TEXT,
  author_name TEXT,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published',
  pinned INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, pinned, created_at);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, visitor)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status);

CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  signer_name TEXT,
  file TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificate_log (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  serial INTEGER,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  printed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  target_label TEXT,
  provider TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id INTEGER PRIMARY KEY,
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bcr ON broadcast_recipients(broadcast_id, status);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  donor_name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  payment_mode TEXT NOT NULL,
  reference TEXT,
  details TEXT,
  paid_on TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_donations_cat ON donations(category, paid_on);
CREATE INDEX IF NOT EXISTS idx_donations_member ON donations(member_id);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  meeting_time TEXT,
  venue TEXT,
  committee_id INTEGER REFERENCES committees(id) ON DELETE SET NULL,
  attendees TEXT NOT NULL DEFAULT '[]',
  minutes TEXT,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);

CREATE TABLE IF NOT EXISTS meeting_files (
  id INTEGER PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  kind TEXT NOT NULL,
  original_name TEXT,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_meeting_files ON meeting_files(meeting_id);
`;

db.exec(SCHEMA);

/** Adds columns introduced after a database was first created. */
function ensureColumns(table, columns) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

// Fields of the printed membership form (सदस्यता फॉर्म).
ensureColumns('members', {
  age: 'INTEGER',
  aadhaar: 'TEXT',
  vansh: 'TEXT',
  perm_village: 'TEXT',
  perm_post: 'TEXT',
  perm_block: 'TEXT',
  perm_tehsil: 'TEXT',
  perm_district: 'TEXT',
  perm_pincode: 'TEXT',
  ward_no: 'TEXT',
  vidhan_sabha: 'TEXT',
  country: 'TEXT',
  family: "TEXT NOT NULL DEFAULT '[]'",
  relatives: "TEXT NOT NULL DEFAULT '[]'",
});

/** Run fn inside a transaction and return its result. */
export function tx(fn) {
  return db.transaction(fn)();
}
