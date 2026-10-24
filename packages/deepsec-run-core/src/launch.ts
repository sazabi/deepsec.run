import type { Sandbox } from "@vercel/sandbox";
import type { ScanLimits } from "./limits";
import {
  CLONE_SCRIPT,
  CLONE_SCRIPT_PATH,
  FALLBACK_MATCHER_PATH,
  FALLBACK_MATCHER_SOURCE,
  FALLBACK_SCRIPT,
  FALLBACK_SCRIPT_PATH,
  REPO_DIR,
  SCAN_OUTPUT_DIR,
  SCAN_SCRIPT,
  SCAN_SCRIPT_PATH,
} from "./scripts";

export interface LaunchInput {
  /** `owner/name` of the repository to clone. */
  fullName: string;
  commitSha: string;
  /** The user's GitHub token; reaches only the short-lived clone process. */
  token: string;
  agent: string;
  /** Empty string selects Deepsec's default model. */
  model: string;
  limits: ScanLimits;
  /** Warm template directory inside the sandbox, or empty for a fresh install. */
  templateDir: string;
}

/**
 * Writes the pipeline scripts into the sandbox and starts the clone and the
 * scan as two detached commands. Returns the scan command.
 */
export async function launchScan(sandbox: Sandbox, input: LaunchInput) {
  await sandbox.mkDir(SCAN_OUTPUT_DIR);
  await sandbox.writeFiles([
    { path: SCAN_SCRIPT_PATH, content: Buffer.from(SCAN_SCRIPT), mode: 0o755 },
    {
      path: CLONE_SCRIPT_PATH,
      content: Buffer.from(CLONE_SCRIPT),
      mode: 0o755,
    },
    {
      path: FALLBACK_SCRIPT_PATH,
      content: Buffer.from(FALLBACK_SCRIPT),
      mode: 0o644,
    },
    {
      path: FALLBACK_MATCHER_PATH,
      content: Buffer.from(FALLBACK_MATCHER_SOURCE),
      mode: 0o644,
    },
  ]);
  // The clone is its own detached command: the token lives only in that
  // short-lived process's environment, never in the scan script's tree.
  await sandbox.runCommand({
    cmd: "bash",
    args: [
      CLONE_SCRIPT_PATH,
      REPO_DIR,
      `https://x-access-token@github.com/${input.fullName}.git`,
      input.commitSha,
    ],
    env: { GIT_TOKEN: input.token },
    detached: true,
  });
  return sandbox.runCommand({
    cmd: "bash",
    args: [
      SCAN_SCRIPT_PATH,
      REPO_DIR,
      input.limits.maxFiles === undefined ? "" : String(input.limits.maxFiles),
      input.agent,
      input.model,
      String(input.limits.maxCostUsd),
      input.templateDir,
      String(input.limits.processConcurrency),
      input.limits.serialBatches ? "1" : "",
    ],
    env: {
      AI_GATEWAY_API_KEY: "attached-by-egress-proxy",
      // The sandbox VM is the isolation boundary. Without this, Codex tries a
      // nested bubblewrap sandbox that cannot start here, every tool call
      // fails, and Deepsec records the file as analyzed with no findings.
      DEEPSEC_INSIDE_SANDBOX: "1",
    },
    detached: true,
  });
}
