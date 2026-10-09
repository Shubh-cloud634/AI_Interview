import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * S17: the API must never execute candidate code. This fails CI if API code (or a package it imports)
 * pulls in a process, VM, thread or container-runtime API, or declares a container client dependency.
 * Execution belongs in apps/runner. If a non-execution use is ever truly needed, move it out of the
 * API process rather than allowlisting it here.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCANNED = ['apps/api/src', 'packages/shared/src', 'packages/prompts/src'];

const FORBIDDEN_MODULES = [
  'child_process', 'vm', 'worker_threads', 'cluster',
  'dockerode', 'docker-modem', 'testcontainers', '@kubernetes/client-node', 'node-pty',
  'execa', 'cross-spawn', 'shelljs', 'zx', 'isolated-vm', 'vm2', '@aws-sdk/client-ecs', '@aws-sdk/client-lambda',
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/@-]/g, '\\$&');
const MODULE_RE = new RegExp(
  String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"\x60](?:node:)?(${FORBIDDEN_MODULES.map(esc).join('|')})(?:/[^'"\x60]*)?['"\x60]`,
  'g',
);
const OTHER = [/\bprocess\.binding\s*\(/, /\bprocess\.dlopen\s*\(/, /docker\.sock/, /\bnew\s+Function\s*\(/, /\beval\s*\(/];

export function findViolations(source: string): string[] {
  const hits = [...source.matchAll(MODULE_RE)].map((m) => m[1]!);
  for (const re of OTHER) if (re.test(source)) hits.push(re.source);
  return hits;
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') yield* files(p);
    } else if (/\.(c|m)?[jt]sx?$/.test(name)) yield p;
  }
}

describe('S17: apps/api never executes code', () => {
  it('the detector catches every import form', () => {
    for (const bad of [
      `import { spawn } from 'node:child_process';`,
      `import cp from "child_process"`,
      `const { exec } = require('child_process')`,
      'await import(`node:vm`)',
      `import 'worker_threads'`,
      `import Docker from 'dockerode'`,
      `import { x } from 'child_process/promises'`,
      `process.binding('spawn_sync')`,
      `fetch('http://localhost/v1.41/containers', { socketPath: '/var/run/docker.sock' })`,
    ]) {
      expect(findViolations(bad), bad).not.toEqual([]);
    }
    expect(findViolations(`import { createHash } from 'node:crypto'; const vmName = 'x'; // child_process in a comment is fine`)).toEqual([]);
  });

  it('no API source file imports an execution API', () => {
    const violations: string[] = [];
    for (const dir of SCANNED) {
      let found = true;
      try {
        statSync(join(ROOT, dir));
      } catch {
        found = false;
      }
      if (!found) continue;
      for (const f of files(join(ROOT, dir))) {
        for (const v of findViolations(readFileSync(f, 'utf8'))) violations.push(`${relative(ROOT, f)}: ${v}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('apps/api declares no container-runtime or process-spawning dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(deps.filter((d) => FORBIDDEN_MODULES.includes(d))).toEqual([]);
  });
});
