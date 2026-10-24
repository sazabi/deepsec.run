/** What one scan may spend: files, parallelism, model budget, and sandbox lifetime. */
export interface ScanLimits {
  /** Model spend ceiling in USD, enforced by Deepsec at batch boundaries. */
  maxCostUsd: number;
  /** Files investigated per scan; undefined means every selected file. */
  maxFiles?: number;
  /** Deepsec batches processed in parallel. */
  processConcurrency: number;
  /** One file per batch with a turn limit, so a budget overshoot stays one session. */
  serialBatches: boolean;
  sandboxTimeoutMs: number;
}

const intEnv = (
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
) => {
  const value = Number(env[key]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/**
 * Sandbox lifetime ceiling for Sazabi-member scans. Vercel Sandbox allows 24
 * hours on Pro/Enterprise (@vercel/sandbox README, "Limitations"); an adopted
 * warm sandbox adds this to its remaining lifetime, so the default leaves an
 * hour of headroom below the hard maximum.
 */
const MEMBER_SANDBOX_TIMEOUT_MS = 23 * 60 * 60 * 1000;
/** Member-only spend ceiling in USD; members have no per-scan budget otherwise. */
const MEMBER_MAX_COST_USD = 1000;
/** Parallel Deepsec batches for members: the 4-vCPU sandbox is mostly waiting on the model. */
const MEMBER_PROCESS_CONCURRENCY = 8;

/**
 * Members review every selected file, in parallel, for as long as the sandbox
 * allows; only the ceiling bounds their spend. External scans keep the file
 * cap, a short sandbox, serial one-file batches, and a hard $50 budget.
 */
export function scanLimits(
  isInternal: boolean,
  env: Record<string, string | undefined>,
): ScanLimits {
  if (isInternal)
    return {
      maxCostUsd: intEnv(
        env,
        "DEEPSEC_RUN_MEMBER_MAX_COST_USD",
        MEMBER_MAX_COST_USD,
      ),
      processConcurrency: intEnv(
        env,
        "DEEPSEC_RUN_MEMBER_CONCURRENCY",
        MEMBER_PROCESS_CONCURRENCY,
      ),
      serialBatches: false,
      sandboxTimeoutMs: intEnv(
        env,
        "DEEPSEC_RUN_MEMBER_SANDBOX_TIMEOUT_MS",
        MEMBER_SANDBOX_TIMEOUT_MS,
      ),
    };
  return {
    maxCostUsd: 50,
    maxFiles: intEnv(env, "DEEPSEC_RUN_MAX_FILES", 40),
    processConcurrency: 1,
    serialBatches: true,
    sandboxTimeoutMs: intEnv(
      env,
      "DEEPSEC_RUN_SANDBOX_TIMEOUT_MS",
      45 * 60 * 1000,
    ),
  };
}
