#!/usr/bin/env bash
# Daily logical backup, in ADDITION to the managed provider's PITR (docs/deployment.md "Backups").
# Runs from a scheduled job (cron / CI schedule / k8s CronJob) with:
#   BACKUP_DATABASE_URL  read-only backup role, sslmode=require       (secret manager)
#   BACKUP_AGE_RECIPIENT age public key; the private key is offline    (not secret)
#   BACKUP_BUCKET_URI    e.g. s3://ai-interview-prod-backups/daily     (bucket has Object Lock + lifecycle)
#   APP_ENV              staging | production
# Requires: pg_dump (same major as the server), age, aws CLI (or swap the upload line for your store).
# Output is encrypted before it leaves the machine; nothing is written unencrypted to disk.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_BUCKET_URI:?}" "${APP_ENV:?}"
for bin in pg_dump age aws; do command -v "$bin" >/dev/null || { echo "missing $bin" >&2; exit 1; }; done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object="${BACKUP_BUCKET_URI%/}/${APP_ENV}-${stamp}.dump.age"

# -Fc: custom format (parallel, selective restore). --no-owner/--no-privileges: restore under any role.
pg_dump --dbname="$BACKUP_DATABASE_URL" -Fc --no-owner --no-privileges \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" \
  | aws s3 cp - "$object" --only-show-errors --expected-size 50000000000

echo "backup written: $object"
# TODO(infra): emit a success metric/heartbeat (e.g. push to the monitoring endpoint) so a missing
# backup alerts (docs/deployment.md "Alerts": backup_last_success_age > 26h).
