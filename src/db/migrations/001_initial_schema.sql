create table if not exists users (
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null
);

create table if not exists sites (
  id uuid primary key,
  user_id uuid not null references users(id),
  url text not null,
  normalized_domain text not null,
  created_at timestamptz not null
);

create table if not exists scans (
  id uuid primary key,
  site_id uuid not null references sites(id),
  status text not null,
  status_reason text,
  site_type text not null,
  scanner_version text not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null,
  constraint scans_status_check check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  constraint scans_site_type_check check (site_type in ('B2B', 'B2C_SERVICE', 'ECOMMERCE', 'OTHER'))
);

create table if not exists facts (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  page_url text,
  fact_type text not null,
  value_json jsonb not null,
  created_at timestamptz not null
);

create table if not exists evidence (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  fact_id uuid references facts(id),
  evidence_type text not null,
  page_url text not null,
  payload_json jsonb,
  storage_ref text,
  created_at timestamptz not null
);

create table if not exists findings (
  id uuid primary key,
  scan_id uuid not null references scans(id),
  rule_id text not null,
  rule_version text not null,
  status text not null,
  severity text not null,
  confidence numeric not null,
  summary text not null,
  explanation text not null,
  remediation text not null,
  missing_context text[] not null default '{}',
  created_at timestamptz not null,
  constraint findings_status_check check (status in ('PASS', 'FAIL', 'WARNING', 'MANUAL_CHECK')),
  constraint findings_severity_check check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  constraint findings_confidence_check check (confidence >= 0 and confidence <= 1)
);

create table if not exists finding_evidence (
  finding_id uuid not null references findings(id),
  evidence_id uuid not null references evidence(id),
  primary key (finding_id, evidence_id)
);

create index if not exists sites_user_id_idx on sites(user_id);
create index if not exists sites_normalized_domain_idx on sites(normalized_domain);
create index if not exists scans_site_id_idx on scans(site_id);
create index if not exists scans_site_type_idx on scans(site_type);
create index if not exists facts_scan_id_idx on facts(scan_id);
create index if not exists facts_fact_type_idx on facts(fact_type);
create index if not exists evidence_scan_id_idx on evidence(scan_id);
create index if not exists evidence_fact_id_idx on evidence(fact_id);
create index if not exists findings_scan_id_idx on findings(scan_id);
create index if not exists findings_rule_id_idx on findings(rule_id);
create index if not exists finding_evidence_evidence_id_idx on finding_evidence(evidence_id);
