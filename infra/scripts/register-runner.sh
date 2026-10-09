#!/usr/bin/env bash
# Create an Ed25519 key pair and a bearer credential for one runner instance and register the PUBLIC
# key and the credential's sha256 in sandbox_runners.
# TODO(runner): apps/runner declares `npm run keygen` (src/keygen.ts, not present when this was
# written). Once it exists, prefer it and keep this script only if the formats match: here the
# credential is 32 random bytes as hex, and credential_sha256 = hex(sha256(credential string)).
#
#   infra/scripts/register-runner.sh <runner-name> [--apply-dev]
#
# Dev:   writes infra/dev/runner_key.pem and infra/dev/runner_credential (gitignored, mode 0600).
#        With --apply-dev it inserts the row into the compose postgres and prints RUNNER_ID for
#        `export RUNNER_ID=...`.
# Staging/production: run on a trusted operator machine, store the private key in the secret
#        manager (ai-interview/<env>/runner/<name>/private_key), delete the local copy, and apply the
#        printed SQL through the migration role. One key per runner instance; never share keys.
# Revoke:  update sandbox_runners set revoked_at = now() where name = '<runner-name>';
set -euo pipefail

name="${1:-}"
apply_dev="${2:-}"
if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "usage: $0 <runner-name: lowercase letters, digits, dashes> [--apply-dev]" >&2
  exit 2
fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="$repo_root/infra/dev"
key="$out_dir/runner_key.pem"
cred="$out_dir/runner_credential"
mkdir -p "$out_dir"
for f in "$key" "$cred"; do
  if [[ -e "$f" ]]; then
    echo "refusing to overwrite $f; move it away first" >&2
    exit 1
  fi
done

umask 077
openssl genpkey -algorithm ed25519 -out "$key"
pub="$(openssl pkey -in "$key" -pubout)"
printf '%s' "$(openssl rand -hex 32)" > "$cred"
cred_sha="$(openssl dgst -sha256 -r "$cred" | cut -d' ' -f1)"

# Name is validated above to [a-z0-9-], and a PEM contains only base64, dashes and newlines, so
# neither can break out of the SQL literals.
sql="insert into sandbox_runners (name, public_key, credential_sha256) values ('$name', '$pub', '$cred_sha') returning id;"

if [[ "$apply_dev" == "--apply-dev" ]]; then
  id="$(cd "$repo_root" && printf '%s\n' "$sql" | docker compose exec -T postgres \
    psql -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-ai_interview}" -v ON_ERROR_STOP=1 -qtA | head -n1)"
  echo "registered $name"
  echo "export RUNNER_ID=$id"
else
  echo "private key: $key, credential: $cred (both secret; move to the secret manager)" >&2
  echo "$sql"
fi
