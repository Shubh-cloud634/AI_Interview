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
