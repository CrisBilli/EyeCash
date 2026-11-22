'use strict';
/*
 * EyeCash · server/cli.js
 *
 * Command-line maintenance: `node server.js reset --yes` wipes password and data,
 * `node server.js restore <backup.json>` restores an encrypted backup.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { KDF_ITER } = require('./config');
const { db, delMeta, getMeta, setMeta } = require('./db');

/* ---------- CLI ---------- */
const cli = process.argv[2];
if (cli === 'reset') {
  if (process.argv[3] !== '--yes') {
    console.log('ATTENZIONE: cancella password E tutti i dati. Esegui: node server.js reset --yes');
    process.exit(1);
  }
  db.exec(
    'DELETE FROM meta; DELETE FROM sessions; DELETE FROM state; DELETE FROM history; DELETE FROM inbox;'
  );
  setMeta('kdf_salt', crypto.randomBytes(16).toString('base64'));
  setMeta('kdf_iter', String(KDF_ITER));
  console.log("Fatto. Alla prossima apertura dell'app potrai creare una nuova password.");
  process.exit(0);
}
if (cli === 'restore') {
  const f = process.argv[3];
  if (!f) {
    console.log('Uso: node server.js restore /data/backups/pointofcash-AAAA-MM-GG.json');
    process.exit(1);
  }
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!b.blob || !b.kdf_salt) {
    console.log('File di backup non valido');
    process.exit(1);
  }
  const cur = db.prepare('SELECT ver FROM state WHERE id=1').get();
  const ver = (cur ? cur.ver : 0) + 1;
  db.prepare(
    'INSERT INTO state(id,blob,ver,updated) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob, ver=excluded.ver, updated=excluded.updated'
  ).run(b.blob, ver, Date.now());
  if (getMeta('kdf_salt') !== b.kdf_salt) {
    // backup made by another installation: log in again with the password used back then
    setMeta('kdf_salt', b.kdf_salt);
    setMeta('kdf_iter', String(b.kdf_iter || KDF_ITER));
    delMeta('auth_hash');
    delMeta('auth_salt');
    db.exec('DELETE FROM sessions');
    console.log(
      "Backup ripristinato. Apri l'app e imposta la STESSA password che usavi quando è stato creato il backup."
    );
  } else console.log('Backup ripristinato.');
  process.exit(0);
}

module.exports = { cli };
