#!/usr/bin/env bash
#
# Auth Gateway backup.
#
# Copies the SQLite database out of the container, verifies the COPY, compacts
# it, then mirrors local snapshots to R2.
#
# The verification deliberately opens the copy and never the original. An
# earlier version of the Driver Ledger backup script connected to a path that
# did not exist yet, which SQLite silently created as an empty database, and
# then moved that empty file over the real one. Every step below therefore
# checks that the artefact exists and has a plausible size before touching it,
# and re-checks row counts after the VACUUM.

set -euo pipefail

CONTAINER="auth-gateway"
DB_PATH_IN_CONTAINER="/usr/src/app/data/auth-gateway.db"
SESSIONS_PATH_IN_CONTAINER="/usr/src/app/data/sessions.db"
BACKUP_DIR="/var/backups/auth-gateway"
R2_DEST="R2:auth-gateway-backups"
KEEP_LOCAL=14
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "[$(date -u +%H:%M:%S)] FATAL: $*" >&2; exit 1; }

command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is not installed on the host"
command -v rclone >/dev/null 2>&1 || die "rclone is not installed on the host"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "container $CONTAINER is not running"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

WORK="$(mktemp -d /tmp/agw-backup.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
DB="$WORK/auth-gateway.db"

# ---------------------------------------------------------------- copy out
log "copying database out of $CONTAINER"
docker cp "$CONTAINER:$DB_PATH_IN_CONTAINER" "$DB" || die "docker cp failed"

# ------------------------------------------------- refuse to trust a bad copy
[ -f "$DB" ] || die "the copy does not exist, refusing to continue"
SIZE="$(stat -c %s "$DB")"
[ "$SIZE" -ge 1024 ] || die "the copy is only $SIZE bytes, refusing to continue"
log "copy is $SIZE bytes"

# ------------------------------------------------- verify the copy, not the original
INTEGRITY="$(sqlite3 "$DB" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || die "integrity_check on the copy returned: $INTEGRITY"

USERS_BEFORE="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM users;')"
APPS_BEFORE="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM apps;')"
GRANTS_BEFORE="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM user_apps;')"
LOGS_BEFORE="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM auth_logs;')"
log "rows before vacuum: users=$USERS_BEFORE apps=$APPS_BEFORE grants=$GRANTS_BEFORE logs=$LOGS_BEFORE"

# ------------------------------------------------------------------- compact
sqlite3 "$DB" 'VACUUM;' || die "VACUUM failed on the copy"

# The VACUUM must not have lost anything.
INTEGRITY_2="$(sqlite3 "$DB" 'PRAGMA integrity_check;')"
[ "$INTEGRITY_2" = "ok" ] || die "integrity_check after vacuum returned: $INTEGRITY_2"

USERS_AFTER="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM users;')"
APPS_AFTER="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM apps;')"
GRANTS_AFTER="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM user_apps;')"
LOGS_AFTER="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM auth_logs;')"

[ "$USERS_BEFORE" = "$USERS_AFTER" ] || die "user count changed across the vacuum: $USERS_BEFORE -> $USERS_AFTER"
[ "$APPS_BEFORE" = "$APPS_AFTER" ] || die "app count changed across the vacuum: $APPS_BEFORE -> $APPS_AFTER"
[ "$GRANTS_BEFORE" = "$GRANTS_AFTER" ] || die "grant count changed across the vacuum: $GRANTS_BEFORE -> $GRANTS_AFTER"
[ "$LOGS_BEFORE" = "$LOGS_AFTER" ] || die "log count changed across the vacuum: $LOGS_BEFORE -> $LOGS_AFTER"

FINAL_SIZE="$(stat -c %s "$DB")"
log "verified and compacted: $FINAL_SIZE bytes"

# ------------------------------------------------------------ keep a snapshot
SNAPSHOT="$BACKUP_DIR/auth-gateway-$STAMP.db"
install -m 600 "$DB" "$SNAPSHOT" || die "could not write the snapshot"
log "snapshot written to $SNAPSHOT"

if docker cp "$CONTAINER:$SESSIONS_PATH_IN_CONTAINER" "$BACKUP_DIR/sessions-$STAMP.db" 2>/dev/null; then
  chmod 600 "$BACKUP_DIR/sessions-$STAMP.db"
  log "session store captured"
fi

# ------------------------------------------------------------------- pruning
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/auth-gateway-*.db 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)))
if [ "${#OLD[@]}" -gt 0 ]; then
  log "pruning ${#OLD[@]} snapshot(s) beyond the newest $KEEP_LOCAL"
  rm -f "${OLD[@]}"
fi
mapfile -t OLD_SESS < <(ls -1t "$BACKUP_DIR"/sessions-*.db 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)))
[ "${#OLD_SESS[@]}" -eq 0 ] || rm -f "${OLD_SESS[@]}"

# -------------------------------------------------------------------- upload
log "mirroring to $R2_DEST"
rclone copy "$BACKUP_DIR" "$R2_DEST" --log-level ERROR || die "rclone copy failed"

# Prove the object that landed in R2 is a readable database, rather than
# trusting that the upload worked. rclone lsl reports S3 objects as 4096 bytes
# regardless of real size, so read the object back and open it.
REMOTE_NAME="$(basename "$SNAPSHOT")"
log "verifying $R2_DEST/$REMOTE_NAME by reading it back"
rclone cat "$R2_DEST/$REMOTE_NAME" > "$WORK/readback.db" || die "could not read the object back"
[ -s "$WORK/readback.db" ] || die "the object read back from R2 is empty"

READBACK="$(sqlite3 "$WORK/readback.db" 'PRAGMA integrity_check;')"
[ "$READBACK" = "ok" ] || die "the object in R2 failed integrity_check: $READBACK"

RB_USERS="$(sqlite3 "$WORK/readback.db" 'SELECT COUNT(*) FROM users;')"
RB_APPS="$(sqlite3 "$WORK/readback.db" 'SELECT COUNT(*) FROM apps;')"
[ "$RB_USERS" = "$USERS_AFTER" ] || die "R2 object has $RB_USERS users, expected $USERS_AFTER"
[ "$RB_APPS" = "$APPS_AFTER" ] || die "R2 object has $RB_APPS apps, expected $APPS_AFTER"

log "R2 object verified: users=$RB_USERS apps=$RB_APPS"
log "backup complete"
