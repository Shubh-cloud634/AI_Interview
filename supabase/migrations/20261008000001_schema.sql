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
