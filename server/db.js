'use strict';
/*
 * EyeCash · server/db.js
 *
 * SQLite database (node:sqlite, no dependencies). It stores only encrypted
 * blobs, sessions and settings: the server never sees readable financial data.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DATA, KDF_ITER } = require('./config');

try {
  fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true, mode: 0o700 });
} catch (e) {
  if (e.code === 'EACCES') {
    console.error(
      `\n[EyeCash] Non posso scrivere nella cartella dati (${DATA}).\nSul server esegui:  sudo chown -R 1000:1000 data  (nella cartella di EyeCash) e poi  docker compose restart\n`
    );
    process.exit(1);
  }
  throw e;
}
const db = new DatabaseSync(path.join(DATA, 'pointofcash.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sessions(h TEXT PRIMARY KEY, exp INTEGER);
CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), blob TEXT, ver INTEGER, updated INTEGER);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT, blob TEXT, ver INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, enc TEXT, created INTEGER);
`);
const getMeta = k => {
  const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k);
  return r ? r.v : null;
};
const setMeta = (k, v) =>
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
const delMeta = k => db.prepare('DELETE FROM meta WHERE k=?').run(k);
if (!getMeta('kdf_salt')) setMeta('kdf_salt', crypto.randomBytes(16).toString('base64'));
if (!getMeta('kdf_iter')) setMeta('kdf_iter', String(KDF_ITER));

module.exports = { db, delMeta, getMeta, setMeta };
