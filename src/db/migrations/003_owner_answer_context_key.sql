alter table owner_answers
  add column if not exists context_key text;

update owner_answers
set context_key = ''
where context_key is null;

alter table owner_answers
  alter column context_key set default '',
  alter column context_key set not null;

alter table owner_answers
  drop constraint if exists owner_answers_scan_question_unique;

alter table owner_answers
  drop constraint if exists owner_answers_scan_question_context_unique;

alter table owner_answers
  add constraint owner_answers_scan_question_context_unique unique (scan_id, question_id, context_key);
