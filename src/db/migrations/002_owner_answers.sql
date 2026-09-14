create table if not exists owner_answers (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  question_id text not null,
  answer_json jsonb not null,
  provenance text not null,
  answered_at timestamptz not null,
  updated_at timestamptz not null,
  constraint owner_answers_provenance_check check (provenance in ('OWNER')),
  constraint owner_answers_scan_question_unique unique (scan_id, question_id)
);

create index if not exists owner_answers_scan_id_idx on owner_answers(scan_id);
create index if not exists owner_answers_question_id_idx on owner_answers(question_id);
