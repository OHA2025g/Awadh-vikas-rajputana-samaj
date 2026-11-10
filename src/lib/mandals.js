import { db } from '../db.js';

/*
 * A member's मंडल is the विधानसभा written on their सदस्यता फॉर्म. Every विधानसभा on any form
 * becomes a मंडल option, and choosing a मंडल anywhere writes it back as the विधानसभा.
 */

export async function mandalNames() {
  return (await db.prepare('SELECT name FROM mandals ORDER BY sort_order, id').all()).map((r) => r.name);
}

const findByName = db.prepare('SELECT id, name FROM mandals WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1');
const nameById = db.prepare('SELECT name FROM mandals WHERE id = ?');
const insertMandal = db.prepare(
  'INSERT INTO mandals (name, sort_order) VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM mandals))'
);

/** The मंडल id for a विधानसभा name, creating the मंडल the first time that name is used. */
export async function mandalIdFor(vidhanSabha) {
  const name = String(vidhanSabha ?? '').trim();
  if (!name) return null;
  const found = await findByName.get(name);
  if (found) return found.id;
  return Number((await insertMandal.run(name)).lastInsertRowid);
}

/** Makes a member row's mandal_id and vidhan_sabha agree; the written विधानसभा wins. */
export async function alignMandal(v) {
  if (String(v.vidhan_sabha ?? '').trim()) v.mandal_id = await mandalIdFor(v.vidhan_sabha);
  else if (v.mandal_id) v.vidhan_sabha = (await nameById.get(v.mandal_id))?.name || null;
  return v;
}

/** Explicit मंडल choice (bulk action, approval page): the विधानसभा follows it. */
export async function setMembersMandal(ids, mandalId) {
  const mandal = await nameById.get(mandalId);
  if (!mandal || !ids.length) return 0;
  const info = await db
    .prepare(`UPDATE members SET mandal_id = ?, vidhan_sabha = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(mandalId, mandal.name, ...ids);
  return info.changes;
}

/**
 * Renaming a मंडल renames the विधानसभा on its members' forms. Renaming it to the name of
 * another मंडल merges the two (useful for spelling variants such as "Bhosari" / "भोसरी").
 */
export async function afterMandalRenamed(id, name) {
  const other = await db
    .prepare('SELECT id FROM mandals WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id <> ? ORDER BY id LIMIT 1')
    .get(name, id);
  const target = other ? other.id : id;
  await db.prepare('UPDATE members SET mandal_id = ?, vidhan_sabha = ? WHERE mandal_id IN (?, ?)').run(target, name, id, target);
  if (other) await db.prepare('DELETE FROM mandals WHERE id = ?').run(id);
  return Boolean(other);
}

export async function mandalMemberCount(id) {
  return Number((await db.prepare('SELECT COUNT(*) AS n FROM members WHERE mandal_id = ?').get(id)).n);
}

const CITY_FROM_DISTRICT = "COALESCE(NULLIF(TRIM(perm_district), ''), NULLIF(TRIM(district), ''))";

/**
 * Startup backfill. Fills an empty विधानसभा from the assigned मंडल, or else from शहर (which used to
 * default to the विधानसभा), links every member to their विधानसभा's मंडल, then sets शहर to the
 * स्थायी पते का जिला. Once शहर holds a जिला the शहर → विधानसभा step no longer matches, so this is
 * safe to run on every start.
 */
export async function syncMemberPlaces() {
  await db
    .prepare(
      `UPDATE members m SET vidhan_sabha = md.name FROM mandals md
       WHERE md.id = m.mandal_id AND COALESCE(TRIM(m.vidhan_sabha), '') = ''`
    )
    .run();
  await db
    .prepare(
      `UPDATE members SET vidhan_sabha = TRIM(city)
       WHERE COALESCE(TRIM(vidhan_sabha), '') = '' AND COALESCE(TRIM(city), '') <> ''
         AND LOWER(TRIM(city)) <> LOWER(COALESCE(TRIM(district), ''))
         AND LOWER(TRIM(city)) <> LOWER(COALESCE(TRIM(perm_district), ''))`
    )
    .run();
  const names = await db
    .prepare(
      `SELECT DISTINCT ON (LOWER(TRIM(vidhan_sabha))) TRIM(vidhan_sabha) AS name FROM members
       WHERE COALESCE(TRIM(vidhan_sabha), '') <> '' ORDER BY LOWER(TRIM(vidhan_sabha)), id`
    )
    .all();
  for (const { name } of names) await mandalIdFor(name);
  await db
    .prepare(
      `UPDATE members m SET mandal_id = md.id FROM mandals md
       WHERE COALESCE(TRIM(m.vidhan_sabha), '') <> ''
         AND md.id = (SELECT MIN(x.id) FROM mandals x WHERE LOWER(TRIM(x.name)) = LOWER(TRIM(m.vidhan_sabha)))
         AND m.mandal_id IS DISTINCT FROM md.id`
    )
    .run();
  await db.prepare(`UPDATE members SET city = ${CITY_FROM_DISTRICT} WHERE city IS DISTINCT FROM ${CITY_FROM_DISTRICT}`).run();
}
