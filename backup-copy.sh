#!/usr/bin/env bash
# EyeCash – copia i backup giornalieri (già cifrati) in un'altra posizione:
# disco USB, NAS montato, cartella sincronizzata col cloud...
# Usage:  bash backup-copy.sh /media/usb/eyecash-backups
# Ogni notte alle 3 (crontab -e):
#   0 3 * * * bash $HOME/eyecash/backup-copy.sh /media/usb/eyecash-backups >> $HOME/eyecash-backup.log 2>&1
set -euo pipefail
DEST="${1:?Indica la cartella di destinazione, es. /media/usb/eyecash-backups}"
SRC="$(cd "$(dirname "$0")" && pwd)/data/backups/"
mkdir -p "$DEST"
rsync -a "$SRC" "$DEST/"
echo "$(date '+%F %T') ✔ $(ls "$SRC" | wc -l) backup copiati in $DEST"
