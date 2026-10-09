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
