# DeepSec.run

deepsec.run is Sazabi's hosted service for running the open-source [deepsec](https://github.com/vercel-labs/deepsec) security review tool against eligible public or private GitHub repositories. It gives each repository owner a private report. This repository is the public issue tracker for the hosted service. It also publishes, read-only, the code that decides what happens to a scanned repository and its traces: [`packages/deepsec-run-core`](packages/deepsec-run-core). It contains no customer data or scan reports, and not the rest of the web application.

deepsec is an open-source project from Vercel. deepsec.run is operated by Sazabi and is not a Vercel product, nor is it operated, endorsed, or affiliated with Vercel.

## What is published

[`packages/deepsec-run-core`](packages/deepsec-run-core) is the part of deepsec.run that answers what runs on your repository, where the sandbox can send data, what happens to your GitHub token and the model key, what a scan can spend, what findings contain, and which telemetry fields leave the pipeline. The pinned scripts, egress policy, limits, and telemetry allowlist are all there. The deployed service is built from an exact commit of Sazabi's main branch, and this package's content at that commit is the content published here.

## Report an issue

Use [GitHub Issues](https://github.com/sazabi/deepsec.run/issues/new/choose) for problems with the site, GitHub connection, scan flow, or report display, and to request improvements. Include steps to reproduce and remove repository names, credentials, and other private details.

Issues are public. Never attach scan reports, source code, access tokens, or details of an unpatched vulnerability. To report a security vulnerability in DeepSec.run itself, follow [SECURITY.md](SECURITY.md).

## Privacy

Scan reports are private to the GitHub account that requested the scan. Do not use this repository to share a report or ask us to inspect a private repository. See [deepsec.run](https://deepsec.run) for the service.

## Contributions

This repository contains public documentation, issue forms, and the trust-core package, synced from Sazabi's private monorepo. Pull requests here are not accepted because changes would be overwritten. Please open an issue instead.

The repository materials are licensed under [Apache 2.0](LICENSE). The license file is copied from Sazabi's canonical public-repository template during sync.
