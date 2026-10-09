#!/usr/bin/env node
// Parses every compose file and workflow (duplicate keys are errors, YAML merge keys allowed) and
// enforces the infra invariants that matter most:
//   compose:   no docker.sock anywhere; runner is on its own internal network only, read-only,
//              cap_drop ALL, no-new-privileges, cpu/memory/pids limits, no volumes.
//   workflows: top-level `permissions`, every external `uses:` pinned to a 40-char commit SHA.
//
//   YAML_LIB_DIR=<dir containing node_modules/yaml> node infra/scripts/validate-yaml.mjs
// CI installs `yaml` into a temp dir; the repo does not depend on it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = resolve(process.env.YAML_LIB_DIR ?? process.cwd());
const { parseDocument } = createRequire(join(libDir, 'noop.js'))('yaml');

const root = fileURLToPath(new URL('../..', import.meta.url));
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);

function load(rel) {
  const doc = parseDocument(readFileSync(join(root, rel), 'utf8'), { merge: true, uniqueKeys: true, prettyErrors: true });
  for (const e of doc.errors) err(rel, e.message.split('\n')[0]);
  for (const w of doc.warnings) err(rel, `warning: ${w.message.split('\n')[0]}`);
  return doc.toJS({ maxAliasCount: 100 }) ?? {};
}

const composeFiles = readdirSync(root).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
const workflowDir = join(root, '.github', 'workflows');
const workflows = existsSync(workflowDir) ? readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`) : [];

for (const rel of composeFiles) {
  const c = load(rel);
  const services = c.services ?? {};
  const raw = readFileSync(join(root, rel), 'utf8');
  if (/docker\.sock/.test(raw.replace(/#.*$/gm, ''))) err(rel, 'docker.sock appears outside a comment');
  const runner = services.runner;
  if (!runner) { err(rel, 'no runner service'); continue; }
  const nets = Array.isArray(runner.networks) ? runner.networks : Object.keys(runner.networks ?? {});
  if (nets.length !== 1) err(rel, `runner must be on exactly one network, found [${nets}]`);
  for (const [name, s] of Object.entries(services)) {
    if (name === 'runner') continue;
    const sn = Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {});
    const dbLike = /postgres|migrate|worker/.test(name);
    if (dbLike && sn.some((n) => nets.includes(n))) err(rel, `${name} shares a network with runner`);
  }
  if (runner.read_only !== true) err(rel, 'runner.read_only must be true');
  if (!(runner.cap_drop ?? []).includes('ALL')) err(rel, 'runner.cap_drop must include ALL');
  if (runner.cap_add?.length) err(rel, 'runner must not cap_add');
  if (!(runner.security_opt ?? []).some((o) => /^no-new-privileges(:true)?$/.test(o))) err(rel, 'runner needs no-new-privileges');
  if (runner.privileged) err(rel, 'runner must not be privileged');
  if (runner.volumes?.length) err(rel, 'runner must have no volumes');
  const lim = runner.deploy?.resources?.limits ?? {};
  for (const k of ['cpus', 'memory', 'pids']) if (lim[k] === undefined) err(rel, `runner limit ${k} missing`);
  if (runner.network_mode) err(rel, 'runner must not set network_mode');
  if (rel === 'docker-compose.yml' && c.networks?.[nets[0]]?.internal !== true) err(rel, `runner network ${nets[0]} must be internal`);
  console.log(`ok ${rel}: ${Object.keys(services).length} services, runner on [${nets}]`);
}

for (const rel of workflows) {
  const w = load(rel);
  if (!w.permissions) err(rel, 'missing top-level permissions');
  const uses = [...readFileSync(join(root, rel), 'utf8').matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)].map((m) => m[1]);
  for (const u of uses) {
    if (u.startsWith('./')) continue;
    if (!/@[0-9a-f]{40}$/.test(u)) err(rel, `action not pinned to a commit SHA: ${u}`);
  }
  console.log(`ok ${rel}: ${Object.keys(w.jobs ?? {}).length} jobs, ${uses.length} uses`);
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
console.log(`validate-yaml: ${composeFiles.length} compose + ${workflows.length} workflow files ok`);
