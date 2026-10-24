import { createHash } from "node:crypto";

export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "unknown";
export type FindingVerdict = "candidate" | "machine-revalidated" | "rejected";

/** One finding as the report shows it: commit-linked, with no owner or committer data. */
export interface SourceFinding {
  id: string;
  title: string;
  severity: FindingSeverity;
  verdict: FindingVerdict;
  path: string;
  line?: number;
  summary: string;
  remediation?: string;
  sourceUrl?: string;
}

/** One record of `deepsec export --format json`. */
export interface DeepsecExport {
  title: string;
  description: string;
  severity: string;
  metadata: {
    filePath: string;
    lineNumbers: number[];
    vulnSlug: string;
    revalidation?: { verdict: string };
  };
}

const DEEPSEC_SEVERITY: Record<string, FindingSeverity> = {
  CRITICAL: "critical",
  HIGH: "high",
  HIGH_BUG: "medium",
  MEDIUM: "medium",
  BUG: "low",
  LOW: "low",
};

/**
 * Deepsec's exported description is a Markdown document that also carries
 * owner and committer emails. The report keeps only its Finding and
 * Recommendation sections.
 */
function markdownSection(input: { markdown: string; heading: string }) {
  const { markdown, heading } = input;
  const section = markdown
    .split(/^## /m)
    .find((part) => part.startsWith(`${heading}\n`));
  return section?.slice(heading.length).trim() || undefined;
}

export function isDeepsecExport(value: unknown): value is DeepsecExport[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.title === "string" &&
        typeof item.description === "string" &&
        typeof item.severity === "string" &&
        item.metadata &&
        typeof item.metadata.filePath === "string" &&
        Array.isArray(item.metadata.lineNumbers) &&
        item.metadata.lineNumbers.every(Number.isInteger) &&
        typeof item.metadata.vulnSlug === "string",
    )
  );
}

export function sourceFinding(
  finding: DeepsecExport,
  repo: { fullName: string; commitSha: string },
): SourceFinding {
  const { filePath, lineNumbers, vulnSlug, revalidation } = finding.metadata;
  const line = lineNumbers[0];
  const verdict = revalidation?.verdict;
  return {
    id: createHash("sha256")
      .update(`src:${filePath}:${lineNumbers.join(",")}:${vulnSlug}`)
      .digest("hex")
      .slice(0, 16),
    title: finding.title.replace(/^\[[A-Z_]+\]\s*/, ""),
    severity: DEEPSEC_SEVERITY[finding.severity] ?? "unknown",
    verdict:
      verdict === "true-positive"
        ? "machine-revalidated"
        : ["false-positive", "fixed", "duplicate", "accepted-risk"].includes(
              verdict ?? "",
            )
          ? "rejected"
          : "candidate",
    path: filePath,
    ...(line ? { line } : {}),
    summary:
      markdownSection({ markdown: finding.description, heading: "Finding" }) ??
      finding.title,
    ...(markdownSection({
      markdown: finding.description,
      heading: "Recommendation",
    })
      ? {
          remediation: markdownSection({
            markdown: finding.description,
            heading: "Recommendation",
          }),
        }
      : {}),
    sourceUrl: `https://github.com/${repo.fullName}/blob/${repo.commitSha}/${filePath}${line ? `#L${line}` : ""}`,
  };
}
