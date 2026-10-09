import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Same formats as infra/scripts/register-runner.sh: the credential is 32 random bytes as hex and
 * credential_sha256 is hex(sha256(credential string)).
 * Usage: npm run keygen -- <runner-name> [out-dir]
 */
const name = process.argv[2] ?? '';
const outDir = process.argv[3] ?? '.';
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) {
  console.error('usage: keygen <runner-name: lowercase letters, digits, dashes> [out-dir]');
  process.exit(2);
}
const keyFile = join(outDir, 'runner_key.pem');
const credFile = join(outDir, 'runner_credential');
for (const f of [keyFile, credFile]) {
  if (existsSync(f)) {
    console.error(`refusing to overwrite ${f}; move it away first`);
    process.exit(1);
  }
}
mkdirSync(outDir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const credential = randomBytes(32).toString('hex');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(credFile, credential, { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const sha = createHash('sha256').update(credential).digest('hex');
console.error(`private key: ${keyFile}, credential: ${credFile} (both secret; move to the secret manager)`);
console.log(`insert into sandbox_runners (name, public_key, credential_sha256) values ('${name}', '${pub}', '${sha}') returning id;`);
