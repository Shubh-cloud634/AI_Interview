-- Coding interviews and the isolated runner: only what 20261008000001 lacks.
-- See docs/sandbox-security.md (F3, F7, F8, S16, S18) and docs/architecture.md section 8.

-- ---------- languages ----------
-- addition: display data and a kill switch. limits already exists (ExecLimits jsonb).
alter table languages add column name text;
alter table languages add column version text;
alter table languages add column enabled boolean not null default true;

-- Dev runner images from apps/runner/images. Pin by digest when publishing to a registry.
-- compile_cmd is a syntax check run in its own sandbox invocation (S5/F5: compile is separate).
update languages set name = 'Python', version = '3.12.7', image_ref = 'ai-interview/runner-python:3.12.7',
  compile_cmd = 'python3 -I -m py_compile main.py', run_cmd = 'python3 -I main.py'
  where slug = 'python';
update languages set name = 'JavaScript (Node.js)', version = '22.11.0', image_ref = 'ai-interview/runner-node:22.11.0',
  compile_cmd = 'node --check main.js', run_cmd = 'node --max-old-space-size=192 main.js'
  where slug = 'javascript';

-- ---------- runner registry ----------
-- addition: a bearer credential (stored as sha256) in addition to the Ed25519 key, last-seen for
-- heartbeat-loss alerts (S20), and a strictly increasing request timestamp so a captured signed
-- request cannot be replayed (F7).
alter table sandbox_runners add column credential_sha256 text;
alter table sandbox_runners add column last_seen_at timestamptz;
alter table sandbox_runners add column last_request_ts bigint not null default 0;

-- ---------- run jobs ----------
-- addition: lease bookkeeping and dead-lettering. A failed job with a failure_reason is the dead letter.
alter table run_jobs add column leased_at timestamptz;
alter table run_jobs add column heartbeat_at timestamptz;
alter table run_jobs add column finished_at timestamptz;
alter table run_jobs add column failure_reason text
  check (failure_reason in ('queue_ttl', 'max_attempts', 'runner_internal_error', 'lease_cap'));

-- F8/S18: one active practice run per user, enforced by the database rather than a racy read.
create unique index run_jobs_one_active_visible on run_jobs (user_id)
  where suite = 'visible' and status in ('queued', 'leased');
create index run_jobs_user_created on run_jobs (user_id, created_at);
create index run_jobs_dead_letter on run_jobs (finished_at) where status = 'failed';
create index code_submissions_stage_run_created on code_submissions (stage_run_id, created_at);

-- ---------- hint state ----------
-- addition: per-stage hint level and count (docs/coding-evaluation-spec.md). State only; the
-- interviewer owns producing hints and the evaluator owns the penalty.
create table stage_hints (
  stage_run_id uuid primary key references stage_runs on delete cascade,
  user_id uuid not null references users on delete cascade,
  level smallint not null default 0 check (level between 0 and 3),
  count int not null default 0 check (count >= 0),
  updated_at timestamptz not null default now()
);
alter table stage_hints enable row level security;
grant select, insert, update on stage_hints to app_user;
create policy stage_hints_app_own on stage_hints for all to app_user
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- least privilege for app_user on execution tables ----------
-- Results are written only by the service connection after signature verification. A user-scoped
-- transaction must never be able to forge, edit or delete a result or a lease, or edit a submission.
revoke insert, update, delete on run_results from app_user;
revoke update, delete on run_jobs from app_user;
revoke update, delete on code_submissions from app_user;
