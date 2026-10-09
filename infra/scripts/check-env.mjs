#!/usr/bin/env node
// Fail-closed policy check for a RENDERED env file, run by the deploy job before `compose up`.
//   node infra/scripts/check-env.mjs <development|staging|production> <file> [--service api|worker|migrate]
// Exits 1 and names the variable (never its value) on any violation. No dependencies.
import { readFileSync } from 'node:fs';

const [envName, file, ...rest] = process.argv.slice(2);
const si = rest.indexOf('--service');
const service = si >= 0 ? rest[si + 1] : 'api';
if (!['development', 'staging', 'production'].includes(envName) || !file || !['api', 'worker', 'migrate'].includes(service)) {
  console.error('usage: check-env.mjs <development|staging|production> <file> [--service api|worker|migrate]');
  process.exit(2);
}

const vars = {};
for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i < 1) continue;
  vars[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}

const errors = [];
const fail = (name, why) => errors.push(`${name}: ${why}`);
const need = (name) => {
  if (!vars[name]) fail(name, 'required');
  return vars[name] ?? '';
};
const PLACEHOLDER = /SECRET_FROM_SECRET_MANAGER|PUBLIC_ANON_KEY_FROM|replace-with|CHANGE_ME|git-sha-set-by-pipeline|example\.com|your-org|-ref\.supabase\.co/i;

const strict = envName !== 'development';
for (const [k, v] of Object.entries(vars)) if (strict && PLACEHOLDER.test(v)) fail(k, 'still a placeholder');

const db = need('DATABASE_URL');
if (db && !db.startsWith('postgres')) fail('DATABASE_URL', 'must be a postgres:// URL');
if (strict && db && !/[?&]sslmode=(require|verify-ca|verify-full)\b/.test(db)) fail('DATABASE_URL', 'must set sslmode=require or stricter');

if (service !== 'migrate') {
  if (strict && vars.NODE_ENV !== 'production') fail('NODE_ENV', 'must be production in staging and production');
  const sb = need('SUPABASE_URL');
  if (strict && sb && !sb.startsWith('https://')) fail('SUPABASE_URL', 'must be https');
  if (strict) need('SUPABASE_SERVICE_ROLE_KEY');
  if ((vars.AI_PROVIDER ?? 'anthropic') === 'anthropic') need('ANTHROPIC_API_KEY');
  if (strict && ['debug', 'trace'].includes(vars.LOG_LEVEL)) fail('LOG_LEVEL', 'debug/trace may log request detail; use info or higher');
  if (vars.SUPABASE_JWT_SECRET && vars.SUPABASE_JWT_SECRET.length < 32) fail('SUPABASE_JWT_SECRET', 'shorter than 32 chars');
  if (strict && vars.WORKERS_ENABLED && vars.WORKERS_ENABLED !== 'false' && service === 'api') {
    fail('WORKERS_ENABLED', 'must be false on api; the worker service runs the queue');
  }
}

if (service === 'api') {
  // apps/api defaults CORS_ORIGINS to http://localhost:3000, so an unset value is a violation, not a default.
  const origins = need('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of origins) {
    if (o === '*' || o.includes('*')) fail('CORS_ORIGINS', 'wildcards are not allowed');
    if (strict && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) fail('CORS_ORIGINS', 'each origin must be an exact https origin with no path');
    if (strict && /localhost|127\.0\.0\.1|\.vercel\.app$/i.test(o)) fail('CORS_ORIGINS', 'localhost and preview origins are not allowed');
  }
}

if (errors.length) {
  console.error(`check-env: ${envName}/${service}: ${errors.length} problem(s) in ${file}`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-env: ${envName}/${service}: ok (${Object.keys(vars).length} variables)`);
