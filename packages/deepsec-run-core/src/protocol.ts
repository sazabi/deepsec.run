import type { Sandbox } from "@vercel/sandbox";
import { PROGRESS_DIR, PROGRESS_SCRIPT, SCAN_OUTPUT_DIR } from "./scripts";

/**
 * The scan-stage protocol. The scan script writes `phase.json` (`{ phase }`)
 * as it moves through the pipeline and `failure.json` (`{ step, exitCode }`)
 * when a step fails; the worker reads both between polls. These maps translate
 * a marker phase into the coarse lifecycle phase and the stage the page shows.
 */
export const MARKER_PHASES: Record<
  string,
  "preparing" | "investigating" | "verifying"
> = {
  preparing: "preparing",
  cloning: "preparing",
  installing: "preparing",
  scanning: "preparing",
  investigating: "investigating",
  exporting: "verifying",
  done: "verifying",
};

export const MARKER_STAGES: Record<
  string,
  "cloning" | "installing" | "scanning" | "investigating" | "exporting"
> = {
  preparing: "cloning",
  cloning: "cloning",
  installing: "installing",
  scanning: "scanning",
  investigating: "investigating",
  exporting: "exporting",
  done: "exporting",
};

export function readFailureMarker(text: string | null) {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { step?: unknown }).step === "string" &&
      typeof (value as { exitCode?: unknown }).exitCode === "number"
    )
      return value as { step: string; exitCode: number };
  } catch {}
  return null;
}

export interface DeepsecProgress {
  available: boolean;
  sourceFiles: number | null;
  reviewMode: "built-in" | "fallback" | null;
  tracked: number;
  selected: number;
  analyzed: number;
  sourceCandidates: number;
  candidateFindings: number;
  machineRevalidatedFindings: number;
  rejectedFindings: number;
  files?: Array<{
    path: string;
    status: "pending" | "investigated" | "skipped";
  }>;
}

/** Counts Deepsec's per-file records inside the sandbox; see PROGRESS_SCRIPT. */
export async function readDeepsecProgress(
  sandbox: Sandbox,
): Promise<DeepsecProgress> {
  const result = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", PROGRESS_SCRIPT, PROGRESS_DIR, SCAN_OUTPUT_DIR],
  });
  try {
    const progress = JSON.parse(await result.stdout()) as DeepsecProgress;
    if (!progress.available)
      throw new Error("Deepsec progress directory could not be read.");
    return progress;
  } catch (error) {
    throw new Error("Deepsec progress could not be read.", { cause: error });
  }
}
