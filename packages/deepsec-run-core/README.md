# @sazabi/deepsec-run-core

The trust core of [deepsec.run](https://deepsec.run), Sazabi's hosted service that runs the open-source [deepsec](https://github.com/vercel-labs/deepsec) security review tool over a GitHub repository and returns a private report.

This package holds everything that decides what happens to your code and your traces, in one small place you can read:

| Question                                        | Where to look                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| What runs on my repository?                     | `src/scripts.ts`: the clone, template, fallback, and scan scripts, byte for byte                                   |
| Where can the sandbox send data?                | `src/egress.ts`: the egress policy (GitHub, the npm registry, and the AI Gateway only)                             |
| Can the code in the sandbox read the model key? | No. `src/egress.ts` attaches it at the sandbox proxy; the sandbox only has a placeholder                           |
| What happens to my GitHub token?                | `src/launch.ts` and the clone script: it reaches only the short-lived clone process and is deleted after the fetch |
| How much can a scan spend or run?               | `src/limits.ts`: file cap, parallelism, model-spend ceiling, and sandbox lifetime                                  |
| What do findings contain?                       | `src/findings.ts`: only the finding and recommendation text, with a commit-linked source URL                       |
| What telemetry leaves the pipeline?             | `src/telemetry-fields.ts`: an allowlist of opaque ids, counts, and bounded error codes                             |

This directory is published read-only to [sazabi/deepsec.run](https://github.com/sazabi/deepsec.run) from Sazabi's monorepo on every change; open an issue there instead of a pull request. References to `apps/` and `_checks/` point at that monorepo.

The Next.js application around it (sign-in, repository picker, database, admission rules, cron) is not part of this package.

deepsec is an open-source project from Vercel. deepsec.run is operated by Sazabi and is not a Vercel product, nor operated, endorsed, or affiliated with Vercel.

## Development

```sh
bun run typecheck
bun run lint
```

Every script written into a sandbox is pinned by SHA-256 in the Sazabi monorepo; a script edit is always a deliberate, reviewed change.
