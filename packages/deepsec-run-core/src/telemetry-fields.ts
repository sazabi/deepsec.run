/**
 * The only fields a scan event may carry out of the sandbox pipeline and the
 * worker. Nothing here is a name, URL, source content, raw error, or
 * credential: repository and scan ids are opaque, error codes are bounded
 * identifiers, and counts are numbers. A new field needs an entry here, and
 * therefore a reviewable change to this public package.
 */
export interface SafeEventFields {
  requestId?: string;
  scanId?: string;
  batchId?: string;
  batchSize?: number;
  repoId?: string;
  internal?: boolean;
  phase?: string;
  stage?: string;
  sandboxName?: string;
  durationMs?: number;
  outcome?: string;
  errorCode?: string;
  coverageComplete?: boolean;
  selectedFiles?: number;
  investigatedFiles?: number;
  findings?: number;
  route?: string;
  method?: string;
  status?: number;
  metric?: string;
  value?: number;
  warm?: boolean;
}

/** Wire attribute name for each allowed field. */
export const EVENT_FIELD_KEYS: Record<keyof SafeEventFields, string> = {
  requestId: "request_id",
  scanId: "scan_id",
  batchId: "batch_id",
  batchSize: "batch_size",
  repoId: "repo_id",
  internal: "internal",
  phase: "phase",
  stage: "stage",
  sandboxName: "sandbox_name",
  durationMs: "duration_ms",
  outcome: "outcome",
  errorCode: "error_code",
  coverageComplete: "coverage_complete",
  selectedFiles: "selected_files",
  investigatedFiles: "investigated_files",
  findings: "findings",
  route: "route",
  method: "method",
  status: "status",
  metric: "metric",
  value: "value",
  warm: "warm",
};
