-- Full database setup for the AI Interview app. Paste into Supabase > SQL Editor > New query, then Run. Run it ONCE on an empty project.

-- ===== 20261008000001_schema.sql =====
-- Core schema. Additions beyond docs/architecture.md section 11 are marked "addition:" with the reason.

-- ---------- identity ----------
create table users (
  id uuid primary key, -- equals the Supabase auth user id (JWT sub)
  email text,
  display_name text,
  locale text,
  -- addition: global role; org_member comes from org_members
  platform_role text not null default 'candidate' check (platform_role in ('candidate', 'pack_author', 'admin')),
  created_at timestamptz not null default now()
);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs on delete cascade,
  user_id uuid not null references users on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------- catalog ----------
create table domains (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now()
);

create table packs (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (domain_id, slug)
);

create table pack_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references packs,
  version int not null check (version > 0),
  published_at timestamptz,
  content_hash text,
  created_at timestamptz not null default now(),
  unique (pack_id, version)
);

create table competencies (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references pack_versions,
  slug text not null,
  name text not null,
  description text not null default '',
  parent_id uuid references competencies,
  created_at timestamptz not null default now(),
  unique (pack_version_id, slug)
);

create table rubrics (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references pack_versions,
  slug text not null,
  version int not null check (version > 0),
  created_at timestamptz not null default now(),
  unique (pack_version_id, slug, version)
);

create table rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references rubrics,
  competency_id uuid not null references competencies,
  name text not null,
  weight double precision not null check (weight > 0),
  levels jsonb not null, -- [{score, descriptor}], anchored descriptors per score
  created_at timestamptz not null default now()
);

create table question_templates (
  id uuid primary key default gen_random_uuid(),
  pack_version_id uuid not null references pack_versions,
  kind text not null check (kind in ('conversation', 'coding', 'case', 'quant', 'document', 'whiteboard')),
  tags text[] not null,
  difficulty smallint not null check (difficulty between 1 and 5),
  body jsonb not null,
  rubric_id uuid references rubrics,
  created_at timestamptz not null default now()
);

create table modes (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references packs,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (pack_id, slug)
);

create table mode_versions (
  id uuid primary key default gen_random_uuid(),
  mode_id uuid not null references modes,
  -- addition: the immutable pack version that rubricRef and bank tags resolve against
  pack_version_id uuid not null references pack_versions,
  version int not null check (version > 0),
  spec jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mode_id, version)
);

create table skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table skill_aliases (
  skill_id uuid not null references skills on delete cascade,
  alias text primary key check (alias = lower(alias))
);

create table skill_competencies (
  skill_id uuid not null references skills on delete cascade,
  competency_id uuid not null references competencies,
  weight double precision not null check (weight > 0),
  primary key (skill_id, competency_id)
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references domains,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (domain_id, slug)
);

create table role_requirements (
  role_id uuid not null references roles on delete cascade,
  competency_id uuid not null references competencies,
  min_level double precision not null check (min_level > 0 and min_level <= 1),
  weight double precision not null check (weight > 0),
  primary key (role_id, competency_id)
);

create table resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  skill_id uuid not null references skills,
  level smallint not null check (level between 1 and 5),
  created_at timestamptz not null default now()
);

create table languages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  image_ref text not null,
  compile_cmd text,
  run_cmd text not null,
  limits jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- candidate ----------
-- user_id is denormalized onto every user-owned child table so RLS is a plain column check.
create table resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  object_key text not null unique,
  file_name text not null,
  content_type text not null,
  size_bytes int not null,
  status text not null default 'awaiting_upload'
    check (status in ('awaiting_upload', 'uploaded', 'parsing', 'parsed', 'failed')),
  error text,
  parsed_at timestamptz,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users on delete cascade,
  headline text,
  summary text,
  source_resume_id uuid references resumes on delete set null,
  created_at timestamptz not null default now()
);

create table experiences (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  user_id uuid not null references users on delete cascade,
  org text not null,
  title text not null,
  start_date text,
  end_date text,
  description text,
  created_at timestamptz not null default now()
);

create table education (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  user_id uuid not null references users on delete cascade,
  institution text not null,
  degree text,
  field text,
  start_date text,
  end_date text,
  created_at timestamptz not null default now()
);

create table profile_skills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  user_id uuid not null references users on delete cascade,
  skill_id uuid references skills, -- null when the raw name did not normalize; queued for pack authors
  raw_name text not null,
  claimed_level smallint check (claimed_level between 1 and 5),
  evidence jsonb not null default '[]',
  source text not null check (source in ('resume', 'manual')),
  created_at timestamptz not null default now()
);

create table readiness (
  user_id uuid not null references users on delete cascade,
  competency_id uuid not null references competencies,
  score double precision not null check (score between 0 and 1),
  confidence double precision not null check (confidence between 0 and 1),
  -- addition: per-stream components {resume|interview|coding: {score, confidence, at}} so a recompute
  -- of one stream replaces it instead of double counting
  streams jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, competency_id)
);

-- ---------- interview ----------
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  mode_version_id uuid not null references mode_versions,
  target_role_id uuid references roles,
  status text not null
    check (status in ('created', 'in_stage', 'awaiting_answer', 'processing', 'completed', 'abandoned')),
  stage_idx int, -- addition: n in in_stage(n)
  last_seq int not null default 0, -- addition: highest turn seq, the optimistic-lock token for transitions
  seed int not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table stage_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  user_id uuid not null references users on delete cascade,
  stage_id text not null,
  kind text not null,
  idx int not null,
  status text not null check (status in ('pending', 'active', 'completed', 'skipped')),
  question_ref jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, idx)
);

create table turns (
  id uuid primary key default gen_random_uuid(),
  stage_run_id uuid not null references stage_runs on delete cascade,
  session_id uuid not null references sessions on delete cascade, -- addition: seq is session-wide
  user_id uuid not null references users on delete cascade,
  seq int not null check (seq > 0),
  actor text not null check (actor in ('interviewer', 'candidate')),
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (stage_run_id, seq),
  unique (session_id, seq)
);

create table code_submissions (
  id uuid primary key default gen_random_uuid(),
  stage_run_id uuid not null references stage_runs on delete cascade,
  user_id uuid not null references users on delete cascade,
  language_id uuid not null references languages,
  source text not null check (octet_length(source) <= 65536),
  explanation text check (char_length(explanation) <= 5000), -- addition: approach notes
  created_at timestamptz not null default now()
);

-- addition: registered execution runners. Each has its own Ed25519 key; revoking one stops its
-- leases and result acceptance without touching the others.
create table sandbox_runners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  public_key text not null, -- SPKI PEM
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table run_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references code_submissions on delete cascade,
  user_id uuid not null references users on delete cascade,
  suite text not null check (suite in ('visible', 'full')), -- addition: visible-only practice run vs graded run
  status text not null default 'queued' check (status in ('queued', 'leased', 'completed', 'failed')),
  -- addition: the current lease. A result is accepted only for this (lease_id, runner_id, nonce), once.
  lease_id uuid,
  runner_id uuid references sandbox_runners,
  nonce text,
  lease_expires_at timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 3,
  created_at timestamptz not null default now()
);

create table run_results (
  job_id uuid primary key references run_jobs on delete cascade,
  user_id uuid not null references users on delete cascade,
  runner_id uuid not null references sandbox_runners,
  lease_id uuid not null,
  status text not null check (status in ('passed', 'failed', 'compile_error', 'runtime_error', 'timeout', 'memory_limit', 'output_limit', 'internal_error')),
  per_test jsonb not null, -- [{id, name, hidden, weight, status, passed, timeMs, memKb}]
  stdout text not null default '',
  stderr text not null default '',
  signature text not null,
  created_at timestamptz not null default now()
);

-- ---------- evaluation and reporting ----------
create table evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions on delete cascade,
  user_id uuid not null references users on delete cascade,
  rubric_versions jsonb not null default '[]',
  model text,
  prompt_version text,
  overall double precision,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

-- addition: per-stage rubric application, written by evaluate_stage, aggregated by finalize_evaluation
create table stage_evaluations (
  stage_run_id uuid primary key references stage_runs on delete cascade,
  evaluation_id uuid not null references evaluations on delete cascade,
  user_id uuid not null references users on delete cascade,
  -- failed: the evaluator output was rejected after bounded retries; score stays null, never fabricated
  status text not null check (status in ('scored', 'failed')),
  score double precision check (score between 0 and 1),
  low_confidence boolean not null default false, -- set when the two evaluator passes disagree or evidence was dropped
  criteria jsonb not null default '[]', -- [{criterionId, competencyId, name, weight, score, confidence, rationale, evidence[], disagreement}]
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table competency_scores (
  evaluation_id uuid not null references evaluations on delete cascade,
  competency_id uuid not null references competencies,
  user_id uuid not null references users on delete cascade,
  score double precision not null check (score between 0 and 1),
  confidence double precision not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]',
  primary key (evaluation_id, competency_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null unique references evaluations on delete cascade,
  user_id uuid not null references users on delete cascade,
  body jsonb not null,
  rendered_at timestamptz not null default now()
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users on delete cascade,
  evaluation_id uuid references evaluations on delete set null,
  type text not null check (type in ('domain', 'role_match', 'gap', 'learning_path', 'next_mode')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table session_summaries (
  session_id uuid primary key references sessions on delete cascade,
  user_id uuid not null references users on delete cascade,
  domain_id uuid not null references domains,
  mode_slug text not null,
  overall double precision,
  finished_at timestamptz not null,
  top_gaps jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ---------- platform ----------
create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users on delete cascade,
  name text not null,
  props jsonb not null default '{}', -- ids and numbers only, never free text
  at timestamptz not null default now()
);

create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users on delete set null, -- addition: per-user budget
  role text not null, -- addition: interviewer | evaluator | career | candidate
  task text not null,
  prompt_version text not null,
  model text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost double precision not null default 0,
  latency_ms int not null,
  ok boolean not null,
  attempts int not null default 1,
  error_kind text,
  injection_flags text[] not null default '{}', -- addition: names of matched injection patterns, never the text
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);

-- addition: Postgres job queue (minimal pg-boss equivalent). Enqueue joins the caller's transaction.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'active', 'done', 'failed')),
  singleton_key text unique,
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- addition: stored responses for Idempotency-Key retries
create table idempotency_keys (
  user_id uuid not null references users on delete cascade,
  key text not null,
  request_hash text not null,
  status_code int not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------- indexes (section 15 plus lookups the code makes) ----------
create index sessions_user_created on sessions (user_id, created_at);
create index session_summaries_user_finished on session_summaries (user_id, finished_at);
create index question_templates_pick on question_templates (pack_version_id, kind, difficulty);
create index question_templates_tags on question_templates using gin (tags);
create index resumes_user on resumes (user_id);
create index stage_runs_user on stage_runs (user_id);
create index turns_user on turns (user_id);
create index code_submissions_stage_run on code_submissions (stage_run_id);
create index run_jobs_lease on run_jobs (created_at) where status in ('queued', 'leased');
create index run_jobs_submission on run_jobs (submission_id);
create index ai_calls_user_created on ai_calls (user_id, created_at);
create index events_user_at on events (user_id, at);
create index recommendations_user on recommendations (user_id, created_at);
create index jobs_ready on jobs (run_after) where status in ('queued', 'active');
create index mode_versions_mode on mode_versions (mode_id, version) where published_at is not null;

-- ---------- immutability of published content ----------
create function guard_published_version() returns trigger language plpgsql as $$
begin
  if old.published_at is not null then
    raise exception '% % is published and immutable', tg_table_name, old.id using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create function guard_pack_child() returns trigger language plpgsql as $$
declare
  pv uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    pv := old.pack_version_id;
    if exists (select 1 from pack_versions where id = pv and published_at is not null) then
      raise exception '% belongs to a published pack version', tg_table_name using errcode = 'check_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    pv := new.pack_version_id;
    if exists (select 1 from pack_versions where id = pv and published_at is not null) then
      raise exception '% belongs to a published pack version', tg_table_name using errcode = 'check_violation';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create function guard_rubric_criteria() returns trigger language plpgsql as $$
declare
  rid uuid := case when tg_op = 'DELETE' then old.rubric_id else new.rubric_id end;
begin
  if exists (
    select 1 from rubrics r join pack_versions pv on pv.id = r.pack_version_id
    where r.id = rid and pv.published_at is not null
  ) then
    raise exception 'rubric_criteria belongs to a published pack version' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger pack_versions_immutable before update or delete on pack_versions
  for each row execute function guard_published_version();
create trigger mode_versions_immutable before update or delete on mode_versions
  for each row execute function guard_published_version();
create trigger competencies_immutable before insert or update or delete on competencies
  for each row execute function guard_pack_child();
create trigger rubrics_immutable before insert or update or delete on rubrics
  for each row execute function guard_pack_child();
create trigger question_templates_immutable before insert or update or delete on question_templates
  for each row execute function guard_pack_child();
create trigger mode_versions_parent_immutable before insert or update or delete on mode_versions
  for each row execute function guard_pack_child();
create trigger rubric_criteria_immutable before insert or update or delete on rubric_criteria
  for each row execute function guard_rubric_criteria();

create function forbid_update() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'check_violation';
end $$;
create trigger code_submissions_immutable before update on code_submissions
  for each row execute function forbid_update();
create trigger run_results_immutable before update on run_results
  for each row execute function forbid_update();

-- Hash over slugs and content (not ids) so equal content hashes equally.
create function pack_version_hash(pv uuid) returns text language sql stable as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'competencies', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'description', description) order by slug), '[]')
      from competencies where pack_version_id = pv),
    'rubrics', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'slug', r.slug, 'version', r.version,
        'criteria', (
          select coalesce(jsonb_agg(jsonb_build_object('competency', c.slug, 'name', rc.name, 'weight', rc.weight, 'levels', rc.levels) order by rc.name), '[]')
          from rubric_criteria rc join competencies c on c.id = rc.competency_id where rc.rubric_id = r.id)
      ) order by r.slug, r.version), '[]')
      from rubrics r where r.pack_version_id = pv),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'tags', tags, 'difficulty', difficulty, 'body', body) order by body::text), '[]')
      from question_templates where pack_version_id = pv),
    'modes', (
      select coalesce(jsonb_agg(jsonb_build_object('mode', m.slug, 'version', mv.version, 'spec', mv.spec) order by m.slug), '[]')
      from mode_versions mv join modes m on m.id = mv.mode_id where mv.pack_version_id = pv)
  )::text, 'UTF8')), 'hex')
$$;

-- Mode versions first: once the pack version is published its children are frozen.
create function publish_pack_version(pv uuid) returns void language plpgsql as $$
begin
  update mode_versions set published_at = now() where pack_version_id = pv and published_at is null;
  update pack_versions set published_at = now(), content_hash = pack_version_hash(pv)
    where id = pv and published_at is null;
end $$;

-- ===== 20261008000002_rls.sql =====
-- RLS is the second wall behind the API's ownership checks.
--
-- app_user: the role the API switches to (SET LOCAL ROLE) for user-scoped request work, with
--   request.jwt.claims set so auth.uid() returns the caller. Full DML, but only on own rows.
-- authenticated: Supabase's role for direct PostgREST access. Read-only on own rows, so the web app
--   cannot bypass the interview state machine by writing tables directly.
-- The table owner (migrations, workers, catalog authoring after a role check) bypasses RLS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

grant app_user to current_user;
grant usage on schema public to app_user;

do $$
declare
  t text;
  owned text[] := array[
    'resumes', 'profiles', 'experiences', 'education', 'profile_skills', 'readiness',
    'sessions', 'stage_runs', 'turns', 'code_submissions', 'run_jobs', 'run_results',
    'evaluations', 'stage_evaluations', 'competency_scores', 'reports', 'recommendations',
    'session_summaries', 'events', 'idempotency_keys', 'org_members'
  ];
  catalog text[] := array[
    'domains', 'packs', 'pack_versions', 'competencies', 'rubrics', 'rubric_criteria',
    'question_templates', 'modes', 'mode_versions', 'skills', 'skill_aliases',
    'skill_competencies', 'roles', 'role_requirements', 'resources', 'languages', 'orgs'
  ];
begin
  foreach t in array owned loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to app_user', t);
    execute format('create policy %I on %I for all to app_user using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_app_own', t);
    execute format('create policy %I on %I for select to authenticated using (user_id = auth.uid())', t || '_read_own', t);
  end loop;

  foreach t in array catalog loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on %I to app_user', t);
    execute format('create policy %I on %I for select to app_user, authenticated using (true)', t || '_read_all', t);
  end loop;
end $$;

alter table users enable row level security;
grant select, update, delete on users to app_user;
create policy users_app_own on users for all to app_user using (id = auth.uid()) with check (id = auth.uid());
create policy users_read_own on users for select to authenticated using (id = auth.uid());

-- Platform tables: no user policies at all. Only the API's service connection touches them.
alter table sandbox_runners enable row level security;
alter table ai_calls enable row level security;
alter table audit_log enable row level security;
alter table jobs enable row level security;

-- User-scoped transactions enqueue through this function so the enqueue commits atomically with the
-- state change that caused it, without app_user seeing or editing the queue.
create function enqueue_job(p_name text, p_payload jsonb, p_singleton_key text, p_run_after timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into jobs (name, payload, singleton_key, run_after)
  values (p_name, p_payload, p_singleton_key, coalesce(p_run_after, now()))
  on conflict (singleton_key) do nothing
$$;
revoke all on function enqueue_job(text, jsonb, text, timestamptz) from public;
grant execute on function enqueue_job(text, jsonb, text, timestamptz) to app_user;

-- ===== 20261008000003_seed_packs.sql =====
-- Two example domain packs expressed only as rows and mode_versions.spec JSON.
-- The engine, evaluator and recommender read these generically; nothing in code names either domain.

-- Dev images. Production pins each image by digest (image@sha256:...) built from a minimal, scanned base.
insert into languages (slug, image_ref, compile_cmd, run_cmd, limits) values
  ('python', 'python:3.12-slim', null, 'python3 main.py',
   '{"cpuMs": 2000, "wallMs": 5000, "memoryMb": 256, "pids": 64, "outputBytes": 65536}'),
  ('javascript', 'node:22-alpine', null, 'node main.js',
   '{"cpuMs": 2000, "wallMs": 5000, "memoryMb": 256, "pids": 64, "outputBytes": 65536}');

-- ===================== engineering =====================
do $$
declare
  d uuid; p uuid; pv uuid; m uuid;
  c_ps uuid; c_cq uuid; c_comm uuid; c_sd uuid;
  r_comm uuid; r_code uuid;
  s_py uuid; s_js uuid; s_algo uuid; s_sql uuid; s_dist uuid;
  role_be uuid; role_fe uuid;
  lv jsonb := '[{"score":1,"descriptor":"Missing or incorrect"},{"score":2,"descriptor":"Partial, with gaps"},{"score":3,"descriptor":"Solid and mostly complete"},{"score":4,"descriptor":"Excellent, precise and well reasoned"}]';
begin
  insert into domains (slug, name) values ('engineering', 'Software Engineering') returning id into d;
  insert into packs (domain_id, slug, name) values (d, 'core-engineering', 'Core Engineering') returning id into p;
  insert into pack_versions (pack_id, version) values (p, 1) returning id into pv;

  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'problem-solving', 'Problem solving', 'Breaks problems down and reaches correct solutions') returning id into c_ps;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'code-quality', 'Code quality', 'Readable, idiomatic, tested code') returning id into c_cq;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'communication', 'Communication', 'Explains reasoning clearly and concisely') returning id into c_comm;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'system-design', 'System design', 'Reasons about trade-offs at scale') returning id into c_sd;

  insert into rubrics (pack_version_id, slug, version) values (pv, 'communication', 1) returning id into r_comm;
  insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values
    (r_comm, c_comm, 'Clarity', 1, lv),
    (r_comm, c_ps, 'Depth of reasoning', 0.5, lv);

  insert into rubrics (pack_version_id, slug, version) values (pv, 'code-quality', 1) returning id into r_code;
  insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values
    (r_code, c_ps, 'Correctness', 2, lv),
    (r_code, c_cq, 'Readability', 1, lv),
    (r_code, c_ps, 'Complexity awareness', 1, lv);

  insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id) values
    (pv, 'coding', array['arrays'], 2, $j${
      "title": "Pair sum",
      "prompt": "Read an integer target on the first line and space separated integers on the second. Print the 0-based indices i < j of the first pair that sums to target, separated by a space, or -1 if none.",
      "starterCode": {"python": "import sys\n\ndef main():\n    data = sys.stdin.read().split('\\n')\n\nmain()\n", "javascript": "const lines = require('fs').readFileSync(0, 'utf8').split('\\n');\n"},
      "tests": {
        "visible": [{"name": "basic", "input": "9\n2 7 11 15\n", "expected": "0 1"}],
        "hidden": [
          {"name": "none", "input": "100\n1 2 3\n", "expected": "-1"},
          {"name": "negatives", "input": "0\n-3 1 3\n", "expected": "0 2"}
        ]
      }
    }$j$, r_code),
    (pv, 'coding', array['arrays', 'strings'], 3, $j${
      "title": "Longest unique run",
      "prompt": "Read one line of text. Print the length of the longest substring without repeated characters.",
      "tests": {
        "visible": [{"name": "basic", "input": "abcabcbb\n", "expected": "3"}],
        "hidden": [{"name": "same", "input": "bbbbb\n", "expected": "1"}, {"name": "empty", "input": "\n", "expected": "0"}]
      }
    }$j$, r_code),
    (pv, 'whiteboard', array['system-design'], 3, $j${
      "title": "URL shortener",
      "prompt": "Design a URL shortener handling 10k writes/s and 100k reads/s. Describe the components, data model and how you would scale reads."
    }$j$, null);

  insert into modes (pack_id, slug, name) values (p, 'swe-screen', 'Software engineer screen') returning id into m;
  insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, pv, 1, $j${
    "stages": [
      {"id": "intro", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "behavioral.v1"}, "rubricRef": "communication.v1", "maxTurns": 2, "timeLimitSec": 300, "weight": 0.2},
      {"id": "core", "kind": "coding", "questionSource": {"type": "bank", "tags": ["arrays"], "difficulty": 2}, "rubricRef": "code-quality.v1", "timeLimitSec": 1500, "weight": 0.5},
      {"id": "wrapup", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "wrapup.v1"}, "rubricRef": "communication.v1", "timeLimitSec": 300, "weight": 0.3}
    ],
    "adaptivity": {"difficultyStep": 1, "minScoreToRaise": 0.75}
  }$j$);

  insert into modes (pack_id, slug, name) values (p, 'system-design', 'System design') returning id into m;
  insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, pv, 1, $j${
    "stages": [
      {"id": "design", "kind": "whiteboard", "questionSource": {"type": "bank", "tags": ["system-design"]}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 2400, "weight": 1}
    ]
  }$j$);

  insert into skills (slug, name) values ('python', 'Python') returning id into s_py;
  insert into skills (slug, name) values ('javascript', 'JavaScript') returning id into s_js;
  insert into skills (slug, name) values ('algorithms', 'Algorithms and data structures') returning id into s_algo;
  insert into skills (slug, name) values ('sql', 'SQL') returning id into s_sql;
  insert into skills (slug, name) values ('distributed-systems', 'Distributed systems') returning id into s_dist;
  insert into skill_aliases (skill_id, alias) values
    (s_py, 'python'), (s_py, 'python3'), (s_py, 'py'),
    (s_js, 'javascript'), (s_js, 'js'), (s_js, 'node.js'), (s_js, 'nodejs'), (s_js, 'typescript'),
    (s_algo, 'algorithms'), (s_algo, 'data structures'), (s_algo, 'dsa'),
    (s_sql, 'sql'), (s_sql, 'postgresql'), (s_sql, 'postgres'),
    (s_dist, 'distributed systems'), (s_dist, 'microservices');
  insert into skill_competencies (skill_id, competency_id, weight) values
    (s_py, c_cq, 0.5), (s_py, c_ps, 0.5), (s_js, c_cq, 0.5), (s_algo, c_ps, 1),
    (s_sql, c_sd, 0.3), (s_dist, c_sd, 1);

  insert into roles (domain_id, slug, name) values (d, 'backend-engineer', 'Backend engineer') returning id into role_be;
  insert into roles (domain_id, slug, name) values (d, 'frontend-engineer', 'Frontend engineer') returning id into role_fe;
  insert into role_requirements (role_id, competency_id, min_level, weight) values
    (role_be, c_ps, 0.7, 1), (role_be, c_cq, 0.6, 1), (role_be, c_sd, 0.6, 1), (role_be, c_comm, 0.5, 0.5),
    (role_fe, c_ps, 0.6, 1), (role_fe, c_cq, 0.7, 1), (role_fe, c_comm, 0.6, 0.8);

  insert into resources (title, url, skill_id, level) values
    ('Python official tutorial', 'https://docs.python.org/3/tutorial/', s_py, 1),
    ('Introduction to Algorithms exercises', 'https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/', s_algo, 3),
    ('Designing Data-Intensive Applications', 'https://dataintensive.net/', s_dist, 4);

  perform publish_pack_version(pv);
end $$;

-- ===================== consulting =====================
do $$
declare
  d uuid; p uuid; pv uuid; m uuid;
  c_struct uuid; c_quant uuid; c_synth uuid; c_comm uuid;
  r_comm uuid; r_case uuid; r_quant uuid;
  s_excel uuid; s_model uuid; s_sizing uuid;
  role_sc uuid; role_ba uuid;
  lv jsonb := '[{"score":1,"descriptor":"Missing or incorrect"},{"score":2,"descriptor":"Partial, with gaps"},{"score":3,"descriptor":"Solid and mostly complete"},{"score":4,"descriptor":"Excellent, hypothesis driven and precise"}]';
begin
  insert into domains (slug, name) values ('consulting', 'Management Consulting') returning id into d;
  insert into packs (domain_id, slug, name) values (d, 'case-interviews', 'Case Interviews') returning id into p;
  insert into pack_versions (pack_id, version) values (p, 1) returning id into pv;

  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'structuring', 'Structuring', 'Builds MECE frameworks for ambiguous problems') returning id into c_struct;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'quantitative', 'Quantitative reasoning', 'Accurate, fast business math') returning id into c_quant;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'synthesis', 'Synthesis', 'Turns analysis into a clear recommendation') returning id into c_synth;
  insert into competencies (pack_version_id, slug, name, description) values
    (pv, 'communication', 'Communication', 'Top-down, concise delivery') returning id into c_comm;

  insert into rubrics (pack_version_id, slug, version) values (pv, 'communication', 1) returning id into r_comm;
  insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values
    (r_comm, c_comm, 'Top-down delivery', 1, lv);

  insert into rubrics (pack_version_id, slug, version) values (pv, 'case-structure', 1) returning id into r_case;
  insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values
    (r_case, c_struct, 'Framework quality', 2, lv),
    (r_case, c_synth, 'Recommendation', 1, lv);

  insert into rubrics (pack_version_id, slug, version) values (pv, 'quant-math', 1) returning id into r_quant;
  insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values
    (r_quant, c_quant, 'Accuracy', 2, lv),
    (r_quant, c_comm, 'Explains the math', 1, lv);

  insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id) values
    (pv, 'case', array['market-sizing'], 2, $j${
      "title": "Electric scooters in a mid-size city",
      "prompt": "Our client is considering launching a shared electric scooter service in a city of 800,000 people. Estimate the annual revenue potential and tell me whether they should enter.",
      "exhibits": [{"title": "City facts", "body": "Population 800k. 35% aged 18-40. Average trip fare 3.50. Competitor fleet: 1,200 scooters."}]
    }$j$, r_case),
    (pv, 'case', array['market-sizing', 'profitability'], 3, $j${
      "title": "Regional bakery chain",
      "prompt": "A 40-store bakery chain has seen profits fall 20% in two years while revenue is flat. Walk me through how you would find the cause."
    }$j$, r_case),
    (pv, 'quant', array['profitability'], 2, $j${
      "title": "Break-even",
      "prompt": "Each scooter costs 600 to buy and 1.20 per trip to operate. Fare is 3.50 per trip. How many trips per scooter are needed to break even on the purchase? Show your working.",
      "exhibits": [{"title": "Unit economics", "body": "Purchase 600. Variable cost 1.20/trip. Fare 3.50/trip."}]
    }$j$, r_quant);

  insert into modes (pack_id, slug, name) values (p, 'case-interview', 'Case interview') returning id into m;
  insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, pv, 1, $j${
    "stages": [
      {"id": "fit", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "behavioral.v1"}, "rubricRef": "communication.v1", "timeLimitSec": 300, "weight": 0.2},
      {"id": "case", "kind": "case", "questionSource": {"type": "bank", "tags": ["market-sizing"], "difficulty": 2}, "rubricRef": "case-structure.v1", "maxTurns": 3, "timeLimitSec": 1200, "weight": 0.5},
      {"id": "math", "kind": "quant", "questionSource": {"type": "bank", "tags": ["profitability"], "difficulty": 2}, "rubricRef": "quant-math.v1", "maxTurns": 2, "timeLimitSec": 600, "weight": 0.3}
    ],
    "adaptivity": {"difficultyStep": 1, "minScoreToRaise": 0.8}
  }$j$);

  insert into skills (slug, name) values ('excel', 'Excel') returning id into s_excel;
  insert into skills (slug, name) values ('financial-modeling', 'Financial modeling') returning id into s_model;
  insert into skills (slug, name) values ('market-sizing', 'Market sizing') returning id into s_sizing;
  insert into skill_aliases (skill_id, alias) values
    (s_excel, 'excel'), (s_excel, 'microsoft excel'), (s_excel, 'spreadsheets'),
    (s_model, 'financial modeling'), (s_model, 'financial modelling'), (s_model, 'dcf'),
    (s_sizing, 'market sizing'), (s_sizing, 'market research');
  insert into skill_competencies (skill_id, competency_id, weight) values
    (s_excel, c_quant, 0.5), (s_model, c_quant, 1), (s_sizing, c_struct, 0.7), (s_sizing, c_quant, 0.3);

  insert into roles (domain_id, slug, name) values (d, 'strategy-consultant', 'Strategy consultant') returning id into role_sc;
  insert into roles (domain_id, slug, name) values (d, 'business-analyst', 'Business analyst') returning id into role_ba;
  insert into role_requirements (role_id, competency_id, min_level, weight) values
    (role_sc, c_struct, 0.75, 1), (role_sc, c_synth, 0.7, 1), (role_sc, c_quant, 0.65, 1), (role_sc, c_comm, 0.7, 0.8),
    (role_ba, c_quant, 0.6, 1), (role_ba, c_struct, 0.5, 0.8), (role_ba, c_comm, 0.5, 0.5);

  insert into resources (title, url, skill_id, level) values
    ('Case in Point', 'https://www.caseinpoint.com/', s_sizing, 2),
    ('Corporate Finance Institute: modeling basics', 'https://corporatefinanceinstitute.com/', s_model, 2);

  perform publish_pack_version(pv);
end $$;

-- ===== 20261008000100_coding_runner.sql =====
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

-- ===== 20261008000200_harden_functions.sql =====
-- Supabase exposes public functions over PostgREST. Keep internal functions off the anon and authenticated roles
-- and pin search_path on the rest.
revoke execute on function enqueue_job(text, jsonb, text, timestamptz) from anon, authenticated;
revoke execute on function publish_pack_version(uuid) from anon, authenticated;
revoke execute on function pack_version_hash(uuid) from anon, authenticated;

alter function guard_published_version() set search_path = public;
alter function guard_pack_child() set search_path = public;
alter function guard_rubric_criteria() set search_path = public;
alter function forbid_update() set search_path = public;
alter function pack_version_hash(uuid) set search_path = public;
alter function publish_pack_version(uuid) set search_path = public;

-- ===== 20261009000001_interview_types.sql =====
-- Interview types a candidate can pick in practice setup: technical, coding, hr, behavioral.
-- The web app maps them by mode slug: technical-interview, coding-interview, hr-interview, behavioral-interview.
-- Questions for technical, hr and behavioral are generated from the candidate's resume profile
-- (interviewer/technical.v1, hr.v1, behavioral.v1). The coding interview draws from the question bank.
--
-- Published pack versions are frozen by triggers, so v1 is unpublished for the duration of this
-- transaction, extended, and republished. publish_pack_version recomputes content_hash, so the
-- hash still matches the content. Existing mode_versions and sessions are not touched.

create temp table _repub on commit drop as
  select pv.id, p.slug as pack_slug
  from pack_versions pv join packs p on p.id = pv.pack_id
  where p.slug in ('core-engineering', 'case-interviews') and pv.version = 1 and pv.published_at is not null;

alter table pack_versions disable trigger pack_versions_immutable;
update pack_versions set published_at = null, content_hash = null where id in (select id from _repub);
alter table pack_versions enable trigger pack_versions_immutable;

do $$
declare
  r record;
  m uuid;
  r_code uuid;
begin
  for r in select id as pv, pack_slug from _repub loop
    -- Technical interview: three escalating resume-based technical rounds.
    insert into modes (pack_id, slug, name) select pack_id, 'technical-interview', 'Technical interview' from pack_versions where id = r.pv
      on conflict (pack_id, slug) do nothing;
    select m2.id into m from modes m2 join pack_versions pv on pv.pack_id = m2.pack_id where pv.id = r.pv and m2.slug = 'technical-interview';
    insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, r.pv, 1, $j${
      "stages": [
        {"id": "fundamentals", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "technical.v1", "difficulty": 2}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 600, "weight": 0.3},
        {"id": "applied", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "technical.v1", "difficulty": 3}, "rubricRef": "communication.v1", "maxTurns": 4, "timeLimitSec": 1200, "weight": 0.5},
        {"id": "depth", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "technical.v1", "difficulty": 4}, "rubricRef": "communication.v1", "maxTurns": 2, "timeLimitSec": 300, "weight": 0.2}
      ]
    }$j$::jsonb) on conflict (mode_id, version) do nothing;

    -- HR interview: motivation and fit, then a closing reflection.
    insert into modes (pack_id, slug, name) select pack_id, 'hr-interview', 'HR interview' from pack_versions where id = r.pv
      on conflict (pack_id, slug) do nothing;
    select m2.id into m from modes m2 join pack_versions pv on pv.pack_id = m2.pack_id where pv.id = r.pv and m2.slug = 'hr-interview';
    insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, r.pv, 1, $j${
      "stages": [
        {"id": "introduction", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "hr.v1", "difficulty": 1}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 600, "weight": 0.3},
        {"id": "motivation-fit", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "hr.v1", "difficulty": 2}, "rubricRef": "communication.v1", "maxTurns": 4, "timeLimitSec": 900, "weight": 0.45},
        {"id": "closing", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "wrapup.v1"}, "rubricRef": "communication.v1", "maxTurns": 2, "timeLimitSec": 600, "weight": 0.25}
      ]
    }$j$::jsonb) on conflict (mode_id, version) do nothing;

    -- Behavioral interview: three STAR-style rounds of rising difficulty.
    insert into modes (pack_id, slug, name) select pack_id, 'behavioral-interview', 'Behavioral interview' from pack_versions where id = r.pv
      on conflict (pack_id, slug) do nothing;
    select m2.id into m from modes m2 join pack_versions pv on pv.pack_id = m2.pack_id where pv.id = r.pv and m2.slug = 'behavioral-interview';
    insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, r.pv, 1, $j${
      "stages": [
        {"id": "teamwork", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "behavioral.v1", "difficulty": 2}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 700, "weight": 0.3},
        {"id": "challenge", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "behavioral.v1", "difficulty": 3}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 700, "weight": 0.4},
        {"id": "leadership", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "behavioral.v1", "difficulty": 4}, "rubricRef": "communication.v1", "maxTurns": 3, "timeLimitSec": 700, "weight": 0.3}
      ]
    }$j$::jsonb) on conflict (mode_id, version) do nothing;

    -- Coding interview: engineering only (it needs the code-quality rubric and the sandbox).
    if r.pack_slug = 'core-engineering' then
      select id into r_code from rubrics where pack_version_id = r.pv and slug = 'code-quality' and version = 1;

      insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id)
      select r.pv, 'coding', array['strings', 'stacks'], 2, $j${
        "title": "Balanced brackets",
        "prompt": "Read one line containing only the characters ()[]{}. Print true if every bracket is closed in the correct order, otherwise print false. An empty line is balanced.",
        "tests": {
          "visible": [{"name": "nested", "input": "([]{})\n", "expected": "true"}],
          "hidden": [
            {"name": "mismatch", "input": "(]\n", "expected": "false"},
            {"name": "unclosed", "input": "((\n", "expected": "false"},
            {"name": "empty", "input": "\n", "expected": "true"},
            {"name": "deep", "input": "{[()()]}\n", "expected": "true"},
            {"name": "starts-closed", "input": "]\n", "expected": "false"}
          ]
        }
      }$j$::jsonb, r_code
      where not exists (select 1 from question_templates where pack_version_id = r.pv and body ->> 'title' = 'Balanced brackets');

      insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id)
      select r.pv, 'coding', array['strings', 'hashing'], 3, $j${
        "title": "Most frequent word",
        "prompt": "Read one line of lowercase words separated by single spaces. Print the word that appears most often. If several words tie, print the one that appears first in the line.",
        "tests": {
          "visible": [{"name": "basic", "input": "the cat and the dog\n", "expected": "the"}],
          "hidden": [
            {"name": "all-unique", "input": "a b c\n", "expected": "a"},
            {"name": "tie-first-wins", "input": "b a a b\n", "expected": "b"},
            {"name": "single", "input": "x\n", "expected": "x"},
            {"name": "clear-winner", "input": "go go stop stop stop\n", "expected": "stop"}
          ]
        }
      }$j$::jsonb, r_code
      where not exists (select 1 from question_templates where pack_version_id = r.pv and body ->> 'title' = 'Most frequent word');

      insert into modes (pack_id, slug, name) select pack_id, 'coding-interview', 'Coding interview' from pack_versions where id = r.pv
        on conflict (pack_id, slug) do nothing;
      select m2.id into m from modes m2 join pack_versions pv on pv.pack_id = m2.pack_id where pv.id = r.pv and m2.slug = 'coding-interview';
      insert into mode_versions (mode_id, pack_version_id, version, spec) values (m, r.pv, 1, $j${
        "stages": [
          {"id": "warm-up", "kind": "coding", "questionSource": {"type": "bank", "tags": ["strings"], "difficulty": 2}, "rubricRef": "code-quality.v1", "timeLimitSec": 900, "weight": 0.4},
          {"id": "challenge", "kind": "coding", "questionSource": {"type": "bank", "tags": ["strings"], "difficulty": 3}, "rubricRef": "code-quality.v1", "timeLimitSec": 900, "weight": 0.4},
          {"id": "explain", "kind": "conversation", "questionSource": {"type": "generated", "promptRef": "technical.v1", "difficulty": 3}, "rubricRef": "communication.v1", "maxTurns": 2, "timeLimitSec": 300, "weight": 0.2}
        ]
      }$j$::jsonb) on conflict (mode_id, version) do nothing;
    end if;
  end loop;
end $$;

select publish_pack_version(id) from _repub;
