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
