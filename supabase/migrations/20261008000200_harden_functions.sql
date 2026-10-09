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
