import { randomUUID } from "node:crypto";
import type { Fact } from "@/facts/types";
import type { Evidence, EvidenceType } from "@/evidence/types";
import type { Finding } from "@/findings/types";
import type { RuleEvaluation } from "@/rule-engine/types";
import type { Queryable } from "./client";
import type { FindingStatus, Scan, Severity, Site, SiteType, User } from "./schema";

type UserRow = {
  id: string;
  email: string;
  created_at: Date;
};

type SiteRow = {
  id: string;
  user_id: string;
  url: string;
  normalized_domain: string;
  created_at: Date;
};

type ScanRow = {
  id: string;
  site_id: string;
  status: Scan["status"];
  status_reason: string | null;
  site_type: SiteType;
  scanner_version: string;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
};

type FactRow = {
  id: string;
  scan_id: string;
  page_url: string | null;
  fact_type: string;
  value_json: Record<string, unknown>;
  created_at: Date;
};

type EvidenceRow = {
  id: string;
  scan_id: string;
  fact_id: string | null;
  evidence_type: EvidenceType;
  page_url: string;
  payload_json: Record<string, unknown> | null;
  storage_ref: string | null;
  created_at: Date;
};

type FindingRow = {
  id: string;
  scan_id: string;
  rule_id: string;
  rule_version: string;
  status: FindingStatus;
  severity: Severity;
  confidence: string | number;
  summary: string;
  explanation: string;
  remediation: string;
  missing_context: string[];
  created_at: Date;
};

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at
  };
}

function mapSite(row: SiteRow): Site {
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    normalizedDomain: row.normalized_domain,
    createdAt: row.created_at
  };
}

function mapScan(row: ScanRow): Scan {
  return {
    id: row.id,
    siteId: row.site_id,
    status: row.status,
    statusReason: row.status_reason,
    siteType: row.site_type,
    scannerVersion: row.scanner_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

function mapFact(row: FactRow): Fact {
  return {
    id: row.id,
    scanId: row.scan_id,
    pageUrl: row.page_url ?? undefined,
    factType: row.fact_type,
    value: row.value_json,
    createdAt: row.created_at
  };
}

function mapEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    scanId: row.scan_id,
    factId: row.fact_id ?? undefined,
    evidenceType: row.evidence_type,
    pageUrl: row.page_url,
    payload: row.payload_json ?? undefined,
    storageRef: row.storage_ref ?? undefined,
    createdAt: row.created_at
  };
}

function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    scanId: row.scan_id,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    status: row.status,
    severity: row.severity,
    confidence: Number(row.confidence),
    summary: row.summary,
    explanation: row.explanation,
    remediation: row.remediation,
    missingContext: row.missing_context,
    createdAt: row.created_at
  };
}

export async function upsertUser(
  db: Queryable,
  input: { id?: string; email: string }
): Promise<User> {
  if (input.id) {
    const result = await db.query<UserRow>(
      `
        insert into users (id, email, created_at)
        values ($1, $2, now())
        on conflict (id) do update set email = excluded.email
        returning *
      `,
      [input.id, input.email]
    );

    return mapUser(result.rows[0]);
  }

  const result = await db.query<UserRow>(
    `
      insert into users (id, email, created_at)
      values ($1, $2, now())
      on conflict (email) do update set email = excluded.email
      returning *
    `,
    [input.id ?? randomUUID(), input.email]
  );

  return mapUser(result.rows[0]);
}

export async function createSite(
  db: Queryable,
  input: { userId: string; url: string; normalizedDomain: string }
): Promise<Site> {
  const result = await db.query<SiteRow>(
    `
      insert into sites (id, user_id, url, normalized_domain, created_at)
      values ($1, $2, $3, $4, now())
      returning *
    `,
    [randomUUID(), input.userId, input.url, input.normalizedDomain]
  );

  return mapSite(result.rows[0]);
}

export async function getSiteByUserAndNormalizedDomain(
  db: Queryable,
  input: { userId: string; normalizedDomain: string }
): Promise<Site | null> {
  const result = await db.query<SiteRow>(
    `
      select *
      from sites
      where user_id = $1 and normalized_domain = $2
      order by created_at asc
      limit 1
    `,
    [input.userId, input.normalizedDomain]
  );

  return result.rows[0] ? mapSite(result.rows[0]) : null;
}

export async function createQueuedScan(
  db: Queryable,
  input: { siteId: string; siteType: SiteType; scannerVersion: string }
): Promise<Scan> {
  const result = await db.query<ScanRow>(
    `
      insert into scans (id, site_id, status, site_type, scanner_version, created_at)
      values ($1, $2, 'QUEUED', $3, $4, now())
      returning *
    `,
    [randomUUID(), input.siteId, input.siteType, input.scannerVersion]
  );

  return mapScan(result.rows[0]);
}

export async function countActiveScansForUser(db: Queryable, userId: string): Promise<number> {
  const result = await db.query<{ count: number | string }>(
    `
      select count(*) as count
      from scans
      inner join sites on sites.id = scans.site_id
      where sites.user_id = $1
        and scans.status in ('QUEUED', 'RUNNING')
    `,
    [userId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function claimNextQueuedScan(
  db: Queryable,
  options: { useSkipLocked?: boolean } = {}
): Promise<Scan | null> {
  const lockClause = options.useSkipLocked === false ? "" : "for update skip locked";
  const result = await db.query<ScanRow>(
    `
      update scans
      set status = 'RUNNING',
          started_at = coalesce(started_at, now()),
          status_reason = null
      where id = (
        select id
        from scans
        where status = 'QUEUED'
        order by created_at asc
        limit 1
        ${lockClause}
      )
      and status = 'QUEUED'
      returning *
    `
  );

  return result.rows[0] ? mapScan(result.rows[0]) : null;
}

export async function markStaleRunningScansFailed(
  db: Queryable,
  input: { olderThanMs: number; statusReason?: string }
): Promise<number> {
  const result = await db.query(
    `
      update scans
      set status = 'FAILED',
          finished_at = now(),
          status_reason = $2
      where status = 'RUNNING'
        and started_at is not null
        and started_at < $1
    `,
    [
      new Date(Date.now() - Math.max(0, input.olderThanMs)),
      input.statusReason ?? "Stale RUNNING scan marked FAILED by worker startup recovery"
    ]
  );

  return result.rowCount ?? 0;
}

export async function claimQueuedScanById(db: Queryable, scanId: string): Promise<Scan | null> {
  const result = await db.query<ScanRow>(
    `
      update scans
      set status = 'RUNNING',
          started_at = coalesce(started_at, now()),
          status_reason = null
      where id = $1 and status = 'QUEUED'
      returning *
    `,
    [scanId]
  );

  return result.rows[0] ? mapScan(result.rows[0]) : null;
}

export async function completeScan(db: Queryable, scanId: string): Promise<Scan> {
  const result = await db.query<ScanRow>(
    `
      update scans
      set status = 'COMPLETED',
          finished_at = now(),
          status_reason = null
      where id = $1 and status = 'RUNNING'
      returning *
    `,
    [scanId]
  );

  if (!result.rows[0]) {
    throw new Error(`Cannot complete scan ${scanId}`);
  }

  return mapScan(result.rows[0]);
}

export async function failScan(
  db: Queryable,
  scanId: string,
  statusReason: string
): Promise<Scan> {
  const result = await db.query<ScanRow>(
    `
      update scans
      set status = 'FAILED',
          finished_at = now(),
          status_reason = $2
      where id = $1 and status = 'RUNNING'
      returning *
    `,
    [scanId, statusReason]
  );

  if (!result.rows[0]) {
    throw new Error(`Cannot fail scan ${scanId}`);
  }

  return mapScan(result.rows[0]);
}

export async function createFact(
  db: Queryable,
  input: {
    scanId: string;
    pageUrl?: string;
    factType: string;
    value: Record<string, unknown>;
  }
): Promise<Fact> {
  const result = await db.query<FactRow>(
    `
      insert into facts (id, scan_id, page_url, fact_type, value_json, created_at)
      values ($1, $2, $3, $4, $5, now())
      returning *
    `,
    [randomUUID(), input.scanId, input.pageUrl ?? null, input.factType, input.value]
  );

  return mapFact(result.rows[0]);
}

export async function createEvidence(
  db: Queryable,
  input: {
    scanId: string;
    factId?: string;
    evidenceType: EvidenceType;
    pageUrl: string;
    payload?: Record<string, unknown>;
    storageRef?: string;
  }
): Promise<Evidence> {
  const result = await db.query<EvidenceRow>(
    `
      insert into evidence (id, scan_id, fact_id, evidence_type, page_url, payload_json, storage_ref, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, now())
      returning *
    `,
    [
      randomUUID(),
      input.scanId,
      input.factId ?? null,
      input.evidenceType,
      input.pageUrl,
      input.payload ?? null,
      input.storageRef ?? null
    ]
  );

  return mapEvidence(result.rows[0]);
}

export async function createFinding(
  db: Queryable,
  input: RuleEvaluation & { scanId: string }
): Promise<Finding> {
  const result = await db.query<FindingRow>(
    `
      insert into findings (
        id,
        scan_id,
        rule_id,
        rule_version,
        status,
        severity,
        confidence,
        summary,
        explanation,
        remediation,
        missing_context,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      returning *
    `,
    [
      randomUUID(),
      input.scanId,
      input.ruleId,
      input.ruleVersion,
      input.status,
      input.severity,
      input.confidence,
      input.summary,
      input.explanation,
      input.remediation,
      input.missingContext
    ]
  );

  for (const evidenceId of input.evidenceIds) {
    await linkFindingEvidence(db, { findingId: result.rows[0].id, evidenceId });
  }

  return mapFinding(result.rows[0]);
}

export async function linkFindingEvidence(
  db: Queryable,
  input: { findingId: string; evidenceId: string }
): Promise<void> {
  await db.query(
    `
      insert into finding_evidence (finding_id, evidence_id)
      values ($1, $2)
      on conflict do nothing
    `,
    [input.findingId, input.evidenceId]
  );
}

export async function getEvidenceIdsForFinding(
  db: Queryable,
  findingId: string
): Promise<string[]> {
  const result = await db.query<{ evidence_id: string }>(
    `
      select evidence_id
      from finding_evidence
      where finding_id = $1
      order by evidence_id
    `,
    [findingId]
  );

  return result.rows.map((row) => row.evidence_id);
}

export async function getFactsForScan(db: Queryable, scanId: string): Promise<Fact[]> {
  const result = await db.query<FactRow>(
    `
      select *
      from facts
      where scan_id = $1
      order by created_at asc
    `,
    [scanId]
  );

  return result.rows.map(mapFact);
}

export async function getEvidenceForScan(db: Queryable, scanId: string): Promise<Evidence[]> {
  const result = await db.query<EvidenceRow>(
    `
      select *
      from evidence
      where scan_id = $1
      order by created_at asc
    `,
    [scanId]
  );

  return result.rows.map(mapEvidence);
}

export async function getEvidenceByIds(db: Queryable, evidenceIds: string[]): Promise<Evidence[]> {
  if (evidenceIds.length === 0) {
    return [];
  }

  const placeholders = evidenceIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<EvidenceRow>(
    `
      select *
      from evidence
      where id in (${placeholders})
      order by created_at asc
    `,
    evidenceIds
  );

  return result.rows.map(mapEvidence);
}

export async function getFindingsForScan(db: Queryable, scanId: string): Promise<Finding[]> {
  const result = await db.query<FindingRow>(
    `
      select *
      from findings
      where scan_id = $1
      order by created_at asc
    `,
    [scanId]
  );

  return result.rows.map(mapFinding);
}

export async function getScanById(db: Queryable, scanId: string): Promise<Scan | null> {
  const result = await db.query<ScanRow>(
    `
      select *
      from scans
      where id = $1
      limit 1
    `,
    [scanId]
  );

  return result.rows[0] ? mapScan(result.rows[0]) : null;
}

export async function getSiteById(db: Queryable, siteId: string): Promise<Site | null> {
  const result = await db.query<SiteRow>(
    `
      select *
      from sites
      where id = $1
      limit 1
    `,
    [siteId]
  );

  return result.rows[0] ? mapSite(result.rows[0]) : null;
}

export async function getScansForSite(db: Queryable, siteId: string): Promise<Scan[]> {
  const result = await db.query<ScanRow>(
    `
      select *
      from scans
      where site_id = $1
      order by created_at asc
    `,
    [siteId]
  );

  return result.rows.map(mapScan);
}
