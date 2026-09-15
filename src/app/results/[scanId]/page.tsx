import Link from "next/link";
import { notFound } from "next/navigation";
import { getScanResult, userSafeScanError } from "@/app/api/scans/helpers";
import {
  buildFindingViewModels,
  EMPTY_RESULT_NOTE,
  EMPTY_RESULT_TITLE,
  type EvidenceViewModel,
  resultsHeaderSummaryText,
  SCOPE_DISCLAIMER,
  summarizeFindings
} from "@/app/results/presentation";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const result = await getScanResult(scanId);

  if (!result.ok) {
    notFound();
  }

  if (result.scan.status === "FAILED") {
    return (
      <main className="shell">
        <section className="panel status-panel">
          <p className="eyebrow">Ошибка проверки</p>
          <h1>Не удалось проверить сайт</h1>
          <p>{userSafeScanError(result.scan.statusReason) ?? "Проверка завершилась ошибкой."}</p>
          <Link className="secondary-button" href="/">
            Попробовать ещё раз
          </Link>
        </section>
      </main>
    );
  }

  if (result.scan.status !== "COMPLETED") {
    return (
      <main className="shell">
        <section className="panel status-panel">
          <p className="eyebrow">{scanStatusLabel(result.scan.status)}</p>
          <h1>Проверяем сайт...</h1>
          <p>Это может занять некоторое время.</p>
          <Link className="secondary-button" href={`/scan/${scanId}`}>
            Вернуться к ходу проверки
          </Link>
        </section>
      </main>
    );
  }

  const findingViews = buildFindingViewModels(result.findings, result.evidenceByFindingId);
  const summary = summarizeFindings(result.findings);
  const visibleFindings = findingViews.filter((finding) => finding.status !== "PASS");
  const passFindings = findingViews.filter((finding) => finding.status === "PASS");
  const findingGroups = [
    { key: "fix", title: "Требуют исправления", items: visibleFindings.filter((finding) => finding.group === "fix") },
    { key: "attention", title: "Требуют внимания", items: visibleFindings.filter((finding) => finding.group === "attention") },
    { key: "manual", title: "Требуют дополнительной проверки", items: visibleFindings.filter((finding) => finding.group === "manual") }
  ];
  const headerSummary = resultsHeaderSummaryText(summary);

  return (
    <main className="shell results-shell">
      <section className="results-header">
        <p className="eyebrow">Результаты проверки</p>
        <h1>{result.site?.normalizedDomain ?? "Сайт"}</h1>
        <p>{headerSummary.checkedText}</p>
        <p>{headerSummary.issueText}</p>
      </section>

      <section className="summary-grid" aria-label="Сводка проверки">
        <div className="summary-item fail">
          <strong>{summary.fail}</strong>
          <span>требуют исправления</span>
        </div>
        <div className="summary-item warning">
          <strong>{summary.warning}</strong>
          <span>требуют внимания</span>
        </div>
        <div className="summary-item manual">
          <strong>{summary.manual}</strong>
          <span>требуют проверки вручную</span>
        </div>
        <div className="summary-item pass">
          <strong>{summary.pass}</strong>
          <span>проверок пройдено</span>
        </div>
      </section>

      {visibleFindings.length === 0 ? (
        <section className="panel">
          <h2>{EMPTY_RESULT_TITLE}</h2>
          <p>{EMPTY_RESULT_NOTE}</p>
        </section>
      ) : (
        <section className="finding-list">
          {findingGroups.map((group) =>
            group.items.length > 0 ? (
              <section className="finding-group" key={group.key}>
                <h2>{group.title}</h2>
                {group.items.map((finding) => (
                  <FindingCard finding={finding} key={finding.id} />
                ))}
              </section>
            ) : null
          )}
        </section>
      )}

      {result.externalServices.length > 0 ? (
        <section className="panel info-panel">
          <h2>Внешние сервисы</h2>
          <p>Обнаруженные внешние сервисы. Некоторые сервисы могут требовать дополнительной проверки обработки и передачи данных.</p>
          <ul className="service-list">
            {result.externalServices.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="pass-details">
        <summary>Проверка пройдена: {passFindings.length}</summary>
        <div className="pass-list">
          {passFindings.map((finding) => (
            <article className="pass-item" key={finding.id}>
              <h3>{finding.summary}</h3>
              {finding.evidence.length > 0 ? (
                <div className="pass-evidence">
                  <h4>Где найдено</h4>
                  {uniqueEvidencePages(finding.evidence).map((pageUrl) => (
                    <p key={`${finding.id}-${pageUrl}`}>
                      <a href={pageUrl} target="_blank" rel="noreferrer">
                        {pageUrl}
                      </a>
                    </p>
                  ))}
                  {userFacingEvidenceValues(finding.evidence).length > 0 ? (
                    <>
                      <h4>Что найдено</h4>
                      {userFacingEvidenceValues(finding.evidence).map((value, index) => (
                        <p key={`${finding.id}-detail-${index}`}>
                          {value.detail ? <span>{value.detail}</span> : null}
                          {value.links.length > 0 ? (
                            <>
                              {value.detail ? " " : null}
                              {value.links.map((link, linkIndex) => (
                                <span key={link.url}>
                                  {linkIndex > 0 ? ", " : null}
                                  <a href={link.url} target="_blank" rel="noreferrer">
                                    {link.label}
                                  </a>
                                </span>
                              ))}
                            </>
                          ) : null}
                        </p>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : (
                <p>Источник не удалось отобразить</p>
              )}
            </article>
          ))}
        </div>
      </details>

      <p className="scope-note">
        {SCOPE_DISCLAIMER}
      </p>
    </main>
  );
}

function FindingCard({ finding }: { finding: ReturnType<typeof buildFindingViewModels>[number] }) {
  return (
    <article className={`finding-card ${finding.group}`}>
      <p className="status-label">{finding.statusLabel}</p>
      <h2>{finding.summary}</h2>
      <p>{finding.explanation}</p>

      {finding.evidence.length > 0 ? (
        <div className="finding-section">
          <h3>Где обнаружено</h3>
          {finding.evidence.map((evidence, index) => (
            <div className="evidence-item" key={`${evidence.pageUrl}-${index}`}>
              <a href={evidence.pageUrl} target="_blank" rel="noreferrer">
                {evidence.pageUrl}
              </a>
              {evidence.detail ? <p>{evidence.detail}</p> : null}
              {evidence.links.length > 0 ? (
                <p>
                  {evidence.links.map((link, index) => (
                    <span key={link.url}>
                      {index > 0 ? ", " : null}
                      <a href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {finding.legalBasis.length > 0 ? (
        <div className="finding-section">
          <h3>Основание</h3>
          <p>{finding.legalBasis.join("; ")}</p>
        </div>
      ) : null}

      {shouldShowRemediation(finding) ? (
        <div className="finding-section">
          <h3>Что сделать</h3>
          <p>{finding.remediation}</p>
        </div>
      ) : null}

      {finding.missingContext.length > 0 ? (
        <div className="finding-section">
          <h3>Что нужно уточнить</h3>
          <p>{finding.missingContext.join(", ")}</p>
        </div>
      ) : null}
    </article>
  );
}

function shouldShowRemediation(finding: ReturnType<typeof buildFindingViewModels>[number]): boolean {
  if (finding.status !== "MANUAL_CHECK") {
    return true;
  }
  return finding.missingContext.length === 0;
}

function uniqueEvidencePages(evidence: EvidenceViewModel[]): string[] {
  return [...new Set(evidence.map((item) => item.pageUrl))];
}

function userFacingEvidenceValues(evidence: EvidenceViewModel[]): Array<{
  detail?: string;
  links: EvidenceViewModel["links"];
}> {
  const values = new Map<string, { detail?: string; links: EvidenceViewModel["links"] }>();

  for (const item of evidence) {
    if (!item.detail && item.links.length === 0) {
      continue;
    }

    const key = [item.detail ?? "", item.links.map((link) => link.url).join("|")].join("::");
    if (!values.has(key)) {
      values.set(key, { detail: item.detail, links: item.links });
    }
  }

  return [...values.values()];
}

function scanStatusLabel(status: string): string {
  if (status === "QUEUED") {
    return "В очереди";
  }
  if (status === "RUNNING") {
    return "Идёт проверка";
  }
  if (status === "COMPLETED") {
    return "Проверка завершена";
  }
  if (status === "FAILED") {
    return "Ошибка проверки";
  }
  return "Проверка";
}
