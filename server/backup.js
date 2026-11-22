'use strict';
/*
 * EyeCash · server/backup.js
 *
 * Daily backup of the (already encrypted) state, kept for KEEP_BACKUP_DAYS.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DATA, KEEP_BACKUP_DAYS, localDate } = require('./config');
const { getMeta } = require('./db');
const { now } = require('./http');

/* ---------- daily backup (already encrypted) ---------- */
function dailyBackup(blob, ver) {
  try {
    const d = localDate();
    const f = path.join(DATA, 'backups', `pointofcash-${d}.json`);
    fs.writeFileSync(
      f + '.tmp',
      JSON.stringify({
        app: 'pointofcash',
        created: new Date().toISOString(),
        ver,
        kdf_salt: getMeta('kdf_salt'),
        kdf_iter: +getMeta('kdf_iter'),
        blob
      }),
      { mode: 0o600 }
    );
    fs.renameSync(f + '.tmp', f);
    const limit = now() - KEEP_BACKUP_DAYS * 864e5;
    for (const n of fs.readdirSync(path.join(DATA, 'backups'))) {
      const p = path.join(DATA, 'backups', n);
      if (/^pointofcash-\d{4}-\d{2}-\d{2}\.json$/.test(n) && fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
    }
  } catch (e) {
    console.error('Backup non riuscito:', e.message);
  }
}

module.exports = { dailyBackup };
