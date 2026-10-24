import { APIError, Sandbox } from "@vercel/sandbox";
import type { egressPolicy, idlePolicy } from "./egress";
import { TEMPLATE_DIR } from "./scripts";

export interface SandboxCreateOptions {
  name: string;
  resources: { vcpus: number };
  timeout: number;
  networkPolicy: typeof idlePolicy | ReturnType<typeof egressPolicy>;
  tags: Record<string, string>;
}

function isSnapshotNotFound(error: unknown) {
  if (!(error instanceof APIError) || error.response.status !== 410)
    return false;
  const body = error.json as { error?: { code?: unknown } } | undefined;
  return body?.error?.code === "snapshot_not_found";
}

/**
 * Creates a sandbox from the warm template snapshot. Any failure is reported
 * through `onFailure` (the caller forgets the template so the next tick
 * rebuilds it) and returns null so the caller falls back to a plain runtime;
 * a scan never fails because its template did.
 */
export async function createFromSnapshot(
  options: SandboxCreateOptions,
  snapshotId: string,
  onFailure: (errorCode: string) => Promise<void>,
): Promise<Sandbox | null> {
  try {
    return await Sandbox.create({
      ...options,
      source: { type: "snapshot", snapshotId },
    });
  } catch (error) {
    // catch-default: a failed template snapshot must never fail a scan; the caller falls back to a plain runtime and `onFailure` records the failure.
    await onFailure(
      isSnapshotNotFound(error)
        ? "snapshot_not_found"
        : error instanceof APIError
          ? `http_${error.response.status}`
          : error instanceof Error
            ? error.name
            : "unknown",
    );
    return null;
  }
}

/** A sandbox on the plain Node runtime, used when no template snapshot is usable. */
export const createPlainSandbox = (options: SandboxCreateOptions) =>
  Sandbox.create({ ...options, runtime: "node24" });

export async function stopSandboxByName(name: string) {
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({
      name,
      resume: false,
    });
  } catch (error) {
    const response =
      error && typeof error === "object" && "response" in error
        ? (error as { response?: { status?: number; statusCode?: number } })
            .response
        : undefined;
    const status =
      response?.status ??
      response?.statusCode ??
      (error && typeof error === "object" && "statusCode" in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : undefined);
    if (status === 404) return;
    throw error;
  }
  if (sandbox && !["stopped", "failed", "aborted"].includes(sandbox.status))
    await sandbox.stop();
}

/**
 * Adopts the owner's warm sandbox for a scan: applies the scan's egress policy
 * and extends its lifetime. A warm sandbox's real timeout started at creation,
 * so one about to expire (`usable` false) is not worth adopting; any failure
 * while adopting stops it and returns null, so the caller creates a fresh
 * sandbox instead of failing the scan.
 */
export async function adoptWarmSandbox(input: {
  name: string;
  usable: boolean;
  policy: ReturnType<typeof egressPolicy>;
  timeoutMs: number;
  onAdoptionFailure: (errorCode: string) => void;
}): Promise<{ sandbox: Sandbox; templateDir: string } | null> {
  const adopted = input.usable
    ? await Sandbox.get({ name: input.name, resume: false }).catch(() => null)
    : null;
  if (adopted && adopted.status === "running") {
    const ready = await adopted
      .updateNetworkPolicy(input.policy)
      .then(() => adopted.extendTimeout(input.timeoutMs))
      .then(
        () => true,
        (error: unknown) => {
          input.onAdoptionFailure(
            error instanceof Error ? error.name : "unknown",
          );
          return false;
        },
      );
    if (ready)
      return {
        sandbox: adopted,
        templateDir: adopted.sourceSnapshotId ? TEMPLATE_DIR : "",
      };
  }
  if (adopted) await adopted.stop().catch(() => undefined);
  else if (!input.usable)
    await stopSandboxByName(input.name).catch(() => undefined);
  return null;
}
