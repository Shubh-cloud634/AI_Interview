#!/usr/bin/env bash
# Monthly restore drill: restore the newest encrypted dump into a THROWAWAY Postgres and check it.
# Never point RESTORE_DATABASE_URL at staging or production.
#   RESTORE_DATABASE_URL  empty scratch database (e.g. an ephemeral container), superuser
#   BACKUP_BUCKET_URI     same bucket the backup job writes
#   AGE_IDENTITY_FILE     age private key, fetched for the drill and shredded afterwards
#   APP_ENV               staging | production
# Record the result (duration, row counts, latest migration) in the drill log; a failed drill is a
# P2 incident.
set -euo pipefail

: "${RESTORE_DATABASE_URL:?}" "${BACKUP_BUCKET_URI:?}" "${AGE_IDENTITY_FILE:?}" "${APP_ENV:?}"
for bin in pg_restore psql age aws; do command -v "$bin" >/dev/null || { echo "missing $bin" >&2; exit 1; }; done

case "$RESTORE_DATABASE_URL" in
  *prod*|*staging*) echo "refusing: RESTORE_DATABASE_URL looks like a real environment" >&2; exit 1 ;;
esac

latest="$(aws s3 ls "${BACKUP_BUCKET_URI%/}/" | awk '{print $4}' | grep "^${APP_ENV}-.*\.dump\.age$" | sort | tail -n1)"
[[ -n "$latest" ]] || { echo "no backups found for $APP_ENV" >&2; exit 1; }
echo "restoring $latest"

start=$(date +%s)
# The migrations expect Supabase's auth schema and roles; the shim provides them on plain Postgres.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../../apps/api/test/supabase-shim.sql"
aws s3 cp "${BACKUP_BUCKET_URI%/}/$latest" - --only-show-errors \
  | age --decrypt --identity "$AGE_IDENTITY_FILE" \
  | pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-privileges --exit-on-error
elapsed=$(( $(date +%s) - start ))

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'latest_migration', max(name) from schema_migrations;
select 'users', count(*) from users;
select 'sessions', count(*) from sessions;
select 'run_jobs', count(*) from run_jobs;
SQL
echo "restore drill ok in ${elapsed}s (RTO target: 60 min)"
