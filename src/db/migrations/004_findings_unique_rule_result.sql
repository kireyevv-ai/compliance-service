delete from finding_evidence
where finding_id in (
  select older.id
  from findings older
  join findings newer
    on newer.scan_id = older.scan_id
   and newer.rule_id = older.rule_id
   and newer.rule_version = older.rule_version
   and (
     newer.created_at > older.created_at
     or (newer.created_at = older.created_at and newer.id > older.id)
   )
);

delete from findings
where id in (
  select older.id
  from findings older
  join findings newer
    on newer.scan_id = older.scan_id
   and newer.rule_id = older.rule_id
   and newer.rule_version = older.rule_version
   and (
     newer.created_at > older.created_at
     or (newer.created_at = older.created_at and newer.id > older.id)
   )
);

alter table findings
  drop constraint if exists findings_scan_rule_version_unique;

alter table findings
  add constraint findings_scan_rule_version_unique unique (scan_id, rule_id, rule_version);
