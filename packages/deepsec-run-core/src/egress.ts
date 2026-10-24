/** Host the sandbox proxy attaches the model key to; the only model endpoint a scan can reach. */
export const AI_GATEWAY_HOST = "ai-gateway.vercel.sh";

/** Egress for a sandbox that has no scan yet: package installs and clones only. */
export const idlePolicy = {
  allow: { "github.com": [], "registry.npmjs.org": [] },
};

/**
 * Egress is limited to what the pipeline needs. The gateway key is attached by
 * the sandbox proxy, so code inside the sandbox never sees it.
 */
export const egressPolicy = (gatewayKey: string) => ({
  allow: {
    "github.com": [],
    "registry.npmjs.org": [],
    [AI_GATEWAY_HOST]: [
      {
        transform: [
          {
            headers: {
              authorization: `Bearer ${gatewayKey}`,
              "x-api-key": gatewayKey,
            },
          },
        ],
      },
    ],
  },
});
