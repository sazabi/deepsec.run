/**
 * The scan pipeline that runs inside each Vercel Sandbox, as one detached
 * command. It writes its progress and outputs under SCAN_OUTPUT_DIR so the
 * worker can poll them between cron ticks.
 *
 * Two isolation rules the script enforces:
 * - The Deepsec workspace lives outside the checkout. A repository can ship
 *   its own `.deepsec/deepsec.config.ts`, which Deepsec would import and run.
 * - The clone credential is removed from the checkout before any agent reads it.
 *
 * The model key is not in the sandbox: AI_GATEWAY_API_KEY is a placeholder that
 * satisfies Deepsec's preflight, and the sandbox egress policy sets the real
 * Authorization header on requests to the AI Gateway.
 */
export const SCAN_OUTPUT_DIR = "/tmp/sazabi-scan";
export const DEEPSEC_WORKSPACE = "/tmp/deepsec-workspace";
export const DEEPSEC_PROJECT_ID = "repo";
export const SCAN_SCRIPT_PATH = `${SCAN_OUTPUT_DIR}/run.sh`;
export const CLONE_SCRIPT_PATH = `${SCAN_OUTPUT_DIR}/clone.sh`;
export const TEMPLATE_SCRIPT_PATH = "/tmp/deepsec-template-build.sh";
/** Where the warm template keeps a pre-installed Deepsec workspace's node_modules and npm cache. */
export const TEMPLATE_DIR = "/vercel/sandbox/.deepsec-template";
/** Where the repository is cloned inside the sandbox (never the sandbox cwd, which a template may populate). */
export const REPO_DIR = "/vercel/sandbox/repo";
export const DEEPSEC_PACKAGE = "deepsec@2.3.10";
export const FALLBACK_SCRIPT_PATH = `${SCAN_OUTPUT_DIR}/prepare-fallback.mjs`;
export const FALLBACK_MATCHER_PATH = `${SCAN_OUTPUT_DIR}/fallback-matcher.ts`;

/**
 * Deepsec 2.3.10 has no matcher for some source languages (Swift, for one),
 * and our scaffold-only setup skips its model-generated matcher phase. When
 * the built-in scan returns no candidates at all, this workspace-local
 * matcher selects every source file and labels the security-relevant signals
 * it contains, so the file budget goes to the most relevant files first.
 *
 * Written as a raw template: it is copied verbatim into the Deepsec
 * workspace, so it must not contain backticks or `${`.
 */
export const FALLBACK_MATCHER_SOURCE = String.raw`import type { DeepsecPlugin, MatcherPlugin } from "deepsec/config";

const skipPath = /(^|\/)(?:test|tests|__tests__|spec|specs|fixture|fixtures|vendor|third_party|generated|build|dist|node_modules|\.build|Pods|Carthage|DerivedData)(\/|$)/i;
const skipFile = /\.(?:test|spec|stories|d)\.[^.]+$|(?:Tests?|Spec)\.(?:swift|kt|java|cs|m|mm)$|\.(?:min|bundle)\.js$/i;

// Each label marks a class of security-relevant code. A file's labels rank it
// for review; a file with none is still reviewed when budget remains.
const signals: Array<[string, RegExp]> = [
  ["network", /\b(?:URLSession|URLRequest|fetch\(|axios|XMLHttpRequest|WebSocket|HttpClient|http\.|requests\.|urllib|net\/http|reqwest|Alamofire|OkHttp|HttpURLConnection)/],
  ["credentials", /\b(?:password|passwd|secret|token|api[_-]?key|credential|keychain|SecItem|private[_-]?key|bearer|client_secret)\b/i],
  ["crypto", /\b(?:CryptoKit|CommonCrypto|crypto\.|AES|RSA|HMAC|SHA1|MD5|CC_SHA|SecKey|randomBytes|arc4random)/],
  ["process", /\b(?:Process\(\)|NSTask|exec\(|execSync|spawn\(|system\(|popen|subprocess|Runtime\.getRuntime|ProcessBuilder|child_process|os\.system)/],
  ["filesystem", /\b(?:FileManager|FileHandle|fs\.|readFile|writeFile|unlink|rmdir|mkdir|open\(|Path\(|os\.path|shutil|NSFileManager)/],
  ["sql", /\b(?:sqlite3|SQLite|CoreData|NSPredicate|rawQuery|execSQL|executeQuery|SELECT\s+.+\s+FROM|INSERT\s+INTO|DELETE\s+FROM)/i],
  ["deserialization", /\b(?:NSKeyedUnarchiver|JSONDecoder|JSONSerialization|PropertyListSerialization|pickle|yaml\.load|unserialize|Marshal\.load|eval\(|new Function\()/],
  ["auth", /\b(?:auth|login|logout|session|oauth|jwt|cookie|permission|entitlement|authorization)\b/i],
  ["external-input", /\b(?:openURL|onOpenURL|handleOpenURL|URLComponents|userActivity|deepLink|universalLink|argv|getenv|ProcessInfo|searchParams)\b|request\.(?:query|params|body)/],
  ["webview", /\b(?:WKWebView|WebView|evaluateJavaScript|javaScriptEnabled|loadHTMLString|allowsArbitraryLoads|NSAppTransportSecurity)\b/],
];

const extensions = [
  "swift", "py", "rs", "go", "java", "kt", "kts", "c", "h", "cc",
  "cpp", "hpp", "m", "mm", "rb", "php", "cs", "scala", "sc", "ex",
  "exs", "erl", "hrl", "dart", "vue", "svelte", "tsx", "ts", "jsx", "js",
  "sh", "sql", "tf",
];

const fallbackMatcher: MatcherPlugin = {
  slug: "fallback-source-review",
  description: "Full-file review for repositories where no built-in matcher applies, ranked by security-relevant signals",
  noiseTier: "noisy",
  filePatterns: extensions.map((extension) => "**/*." + extension),
  match(content, filePath) {
    if (skipPath.test(filePath) || skipFile.test(filePath)) return [];
    const lines = content.split("\n");
    const labels: string[] = [];
    let firstLine = -1;
    for (const [label, pattern] of signals) {
      const index = lines.findIndex((line) => pattern.test(line));
      if (index < 0) continue;
      labels.push(label);
      if (firstLine < 0 || index < firstLine) firstLine = index;
    }
    if (firstLine < 0) firstLine = lines.findIndex((line) => /\S/.test(line));
    if (firstLine < 0) return [];
    return [{
      vulnSlug: "fallback-source-review",
      lineNumbers: [firstLine + 1],
      snippet: lines.slice(Math.max(0, firstLine - 2), firstLine + 3).join("\n"),
      matchedPattern: labels.length > 0 ? "Fallback review: " + labels.join(", ") : "Fallback review: general source file",
    }];
  },
};

export const generatedMatchersPlugin: DeepsecPlugin = {
  name: "deepsec-generated-matchers",
  matchers: [fallbackMatcher],
};
`;

/**
 * Two modes, both run inside the sandbox:
 *   prepare <filesDir> <pluginPath> <matcherSource> — after the built-in
 *     scan: prints `built-in` when any candidate exists, otherwise installs
 *     the fallback matcher and prints `fallback`.
 *   manifest <filesDir> <limit> <outPath> — after the fallback scan: writes
 *     the top <limit> pending files (every pending file when <limit> is
 *     empty), most security signals first, as the JSON array Deepsec's
 *     `process --manifest` expects.
 */
export const FALLBACK_SCRIPT = `
import fs from "node:fs";
import path from "node:path";

const [mode, filesDir, ...rest] = process.argv.slice(2);

const records = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".json")) {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!record || typeof record !== "object" || !Array.isArray(record.candidates)) {
        throw new Error("Deepsec produced an invalid file record");
      }
      records.push(record);
    }
  }
};
try {
  walk(filesDir);
} catch (error) {
  if (!error || error.code !== "ENOENT") throw error;
}

if (mode === "prepare") {
  const [pluginPath, matcherSource] = rest;
  const candidateCount = records.reduce((sum, record) => sum + record.candidates.length, 0);
  if (candidateCount > 0) {
    process.stdout.write("built-in\\n");
  } else {
    fs.copyFileSync(matcherSource, pluginPath);
    process.stdout.write("fallback\\n");
  }
} else if (mode === "manifest") {
  const [limitText, outPath] = rest;
  const limit = limitText === "" ? Infinity : Number(limitText);
  if (limit !== Infinity && (!Number.isInteger(limit) || limit <= 0)) throw new Error("manifest limit must be a positive integer");
  const score = (record) => {
    let best = 0;
    for (const candidate of record.candidates) {
      const pattern = String(candidate.matchedPattern || "");
      if (!pattern.startsWith("Fallback review: ")) return 100;
      if (pattern.includes("general source file")) continue;
      best = Math.max(best, pattern.slice("Fallback review: ".length).split(",").length);
    }
    return best;
  };
  const ranked = records
    .filter((record) => record.candidates.length > 0 && record.status !== "analyzed")
    .map((record) => ({ filePath: record.filePath, score: score(record) }))
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, limit)
    .map((entry) => entry.filePath);
  fs.writeFileSync(outPath, JSON.stringify(ranked));
  process.stdout.write(String(ranked.length) + "\\n");
} else {
  throw new Error("unknown mode: " + mode);
}
`;

/**
 * Clones the repository at an exact commit. Runs as its own short-lived
 * detached command with the GitHub token in its environment only: the token
 * never reaches the scan script's process tree, and the askpass helper is
 * deleted as soon as the fetch ends. Writes clone.json on success.
 */
export const CLONE_SCRIPT = `#!/bin/bash
set -uo pipefail
REPO="$1"
URL="$2"
SHA="$3"
OUT=${SCAN_OUTPUT_DIR}
phase() { printf '{"phase":"%s"}' "$1" > "$OUT/phase.json.tmp.$$" && mv -f "$OUT/phase.json.tmp.$$" "$OUT/phase.json"; }
fail() { printf '{"step":"%s","exitCode":%s}' "$1" "$2" > "$OUT/failure.json.tmp.$$" && mv -f "$OUT/failure.json.tmp.$$" "$OUT/failure.json"; exit "$2"; }

phase cloning
ASKPASS="$OUT/askpass.sh"
printf '#!/bin/sh\\nprintf %%s "$GIT_TOKEN"\\n' > "$ASKPASS"
chmod 700 "$ASKPASS"
export GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0
rm -rf "$REPO"
mkdir -p "$REPO"
if ( git -C "$REPO" init -q && git -C "$REPO" remote add origin "$URL" && git -C "$REPO" fetch -q --depth 1 origin "$SHA" && git -C "$REPO" checkout -q FETCH_HEAD ) > "$OUT/clone.log" 2>&1; then
  :
else
  code=$?
  rm -f "$ASKPASS"
  fail clone "$code"
fi
rm -f "$ASKPASS"
unset GIT_TOKEN GIT_ASKPASS
git -C "$REPO" remote remove origin >/dev/null 2>&1 || true
printf '{"ok":true}' > "$OUT/clone.json"
`;

/**
 * Builds the warm template: Deepsec's workspace dependencies installed once
 * against an empty seed repository, so a scan's install step is a no-op
 * hardlink copy plus a cache-hit npm install. The sandbox is snapshotted
 * right after this script succeeds.
 */
export const TEMPLATE_SCRIPT = `#!/bin/bash
set -uo pipefail
TEMPLATE="$1"
AGENT="$2"
rm -rf "$TEMPLATE"
mkdir -p "$TEMPLATE/seed"
git -C "$TEMPLATE/seed" init -q
printf 'seed\\n' > "$TEMPLATE/seed/README.md"
git -C "$TEMPLATE/seed" -c user.email=template@deepsec.run -c user.name=template add README.md
git -C "$TEMPLATE/seed" -c user.email=template@deepsec.run -c user.name=template commit -q -m seed
npx -y ${DEEPSEC_PACKAGE} init "$TEMPLATE/workspace" "$TEMPLATE/seed" --id ${DEEPSEC_PROJECT_ID} --scaffold-only --agent "$AGENT" --model-auth gateway --headless --output json > "$TEMPLATE/init.json" 2> "$TEMPLATE/init.log" || exit 10
cd "$TEMPLATE/workspace" || exit 11
npm install --no-audit --no-fund --loglevel=error > "$TEMPLATE/install.log" 2>&1 || exit 12
mv "$TEMPLATE/workspace/node_modules" "$TEMPLATE/node_modules" || exit 13
rm -rf "$TEMPLATE/workspace" "$TEMPLATE/seed"
printf '%s\\n' "${DEEPSEC_PACKAGE}" > "$TEMPLATE/ready"
`;

export const SCAN_SCRIPT = `#!/bin/bash
set -uo pipefail
REPO="$1"
LIMIT="$2"
AGENT="$3"
MODEL="\${4:-}"
MAX_COST_USD="\${5:-}"
TEMPLATE="\${6:-}"
CONCURRENCY="\${7:-1}"
SERIAL_BATCHES="\${8:-}"
OUT=${SCAN_OUTPUT_DIR}
WS=${DEEPSEC_WORKSPACE}
DEEPSEC=${DEEPSEC_PACKAGE}

phase() { printf '{"phase":"%s"}' "$1" > "$OUT/phase.json.tmp.$$" && mv -f "$OUT/phase.json.tmp.$$" "$OUT/phase.json"; }
fail() { printf '{"step":"%s","exitCode":%s}' "$1" "$2" > "$OUT/failure.json.tmp.$$" && mv -f "$OUT/failure.json.tmp.$$" "$OUT/failure.json"; exit "$2"; }

# The clone runs as a separate command so its credential never enters this
# process tree. Wait for it (up to 20 minutes) before touching the checkout.
for _ in $(seq 1 2400); do
  [ -f "$OUT/clone.json" ] && break
  [ -f "$OUT/failure.json" ] && exit 1
  sleep 0.5
done
[ -f "$OUT/clone.json" ] || fail clone_timeout 1

git -C "$REPO" remote remove origin >/dev/null 2>&1 || true
git -C "$REPO" ls-files | wc -l | tr -d ' ' > "$OUT/source-files.txt.tmp.$$" && mv -f "$OUT/source-files.txt.tmp.$$" "$OUT/source-files.txt"

phase installing
npx -y "$DEEPSEC" init "$WS" "$REPO" --id ${DEEPSEC_PROJECT_ID} --scaffold-only --agent "$AGENT" --model-auth gateway --headless --output json > "$OUT/init.json" 2> "$OUT/init.log" || fail init $?
cd "$WS" || fail workspace 1
if [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE/ready" ] && [ -d "$TEMPLATE/node_modules" ] && [ ! -d "$WS/node_modules" ]; then
  cp -al "$TEMPLATE/node_modules" "$WS/node_modules" 2>/dev/null || cp -a "$TEMPLATE/node_modules" "$WS/node_modules" || true
  printf 'template\\n' > "$OUT/install-mode.txt"
else
  printf 'fresh\\n' > "$OUT/install-mode.txt"
fi
npm install --no-audit --no-fund --loglevel=error > "$OUT/install.log" 2>&1 || fail install $?

if [ -n "$MAX_COST_USD" ]; then
  node --input-type=module <<'PATCH_DEEPSEC' || fail budget_patch 1
import fs from 'node:fs';
const file = 'node_modules/deepsec/dist/cli.mjs';
const source = fs.readFileSync(file, 'utf8');
const optionNeedle = '.option("--concurrency <n>", "Batches to process in parallel (default: cores - 1)", parseInt).option("--filter <prefix>"';
const optionReplacement = '.option("--concurrency <n>", "Batches to process in parallel (default: cores - 1)", parseInt).option("--max-cost-usd <n>", "Stop AI processing at the configured spend boundary", Number).option("--filter <prefix>"';
const callNeedle = '    batchSize: opts.batchSize,\\n    rootPathOverride: opts.root,';
const callReplacement = '    batchSize: opts.batchSize,\\n    maxCostUsd: opts.maxCostUsd,\\n    rootPathOverride: opts.root,';
const usageNeedle = '        totalCostUsd += batchMeta.costUsd ?? 0;\\n        totalInputTokens += batchMeta.usage?.inputTokens ?? 0;';
const usageReplacement = '        if (params.maxCostUsd !== void 0 && (typeof batchMeta.costUsd !== "number" || !Number.isFinite(batchMeta.costUsd) || batchMeta.costUsd < 0)) {\\n          fs8.writeFileSync("/tmp/sazabi-scan/budget-usage-invalid.json", "{}");\\n          quotaAbort.abort(new Error("Model usage was invalid; scan stopped fail-closed"));\\n          throw new Error("Model cost was missing or invalid.");\\n        }\\n        totalCostUsd += batchMeta.costUsd ?? 0;\\n        totalInputTokens += batchMeta.usage?.inputTokens ?? 0;';
if (source.includes('Model cost was missing or invalid.')) process.exit(0);
if (source.split(optionNeedle).length !== 2 || source.split(callNeedle).length !== 2 || source.split(usageNeedle).length !== 2) {
  throw new Error('Deepsec process API does not match the guarded budget adapter');
}
fs.writeFileSync(file, source.replace(optionNeedle, optionReplacement).replace(callNeedle, callReplacement).replace(usageNeedle, usageReplacement));
PATCH_DEEPSEC
fi

phase scanning
npx deepsec scan --project-id ${DEEPSEC_PROJECT_ID} > "$OUT/scan.log" 2>&1 || fail scan $?
node "$OUT/prepare-fallback.mjs" prepare "$WS/data/${DEEPSEC_PROJECT_ID}/files" "$WS/generated-matchers.ts" "$OUT/fallback-matcher.ts" > "$OUT/fallback-mode.txt" 2> "$OUT/fallback-setup.log" || fail fallback_setup $?
PROCESS_SCOPE=()
if [ "$(cat "$OUT/fallback-mode.txt")" = "fallback" ]; then
  npx deepsec scan --project-id ${DEEPSEC_PROJECT_ID} > "$OUT/fallback-scan.log" 2>&1 || fail fallback_scan $?
  node "$OUT/prepare-fallback.mjs" manifest "$WS/data/${DEEPSEC_PROJECT_ID}/files" "$LIMIT" "$OUT/manifest.json" > "$OUT/fallback-manifest.txt" 2> "$OUT/fallback-manifest.log" || fail fallback_manifest $?
  PROCESS_SCOPE=(--manifest "$OUT/manifest.json")
fi

phase investigating
MODEL_ARGS=()
if [ -n "$MODEL" ]; then MODEL_ARGS=(--model "$MODEL"); fi
PROCESS_ARGS=(--concurrency "$CONCURRENCY")
# An empty LIMIT investigates every selected file.
if [ -n "$LIMIT" ]; then PROCESS_ARGS+=(--limit "$LIMIT"); fi
# Deepsec applies the budget at batch boundaries, so an overshoot is bounded by
# the batches in flight; external scans run one-file serial batches to keep it
# to one bounded model session.
if [ -n "$MAX_COST_USD" ]; then PROCESS_ARGS+=(--max-cost-usd "$MAX_COST_USD"); fi
if [ -n "$SERIAL_BATCHES" ]; then PROCESS_ARGS+=(--batch-size 1 --max-turns 12); fi
PROCESS_STATUS=0
npx deepsec process --project-id ${DEEPSEC_PROJECT_ID} --agent "$AGENT" "\${MODEL_ARGS[@]}" "\${PROCESS_ARGS[@]}" "\${PROCESS_SCOPE[@]}" > "$OUT/process.log" 2>&1 || PROCESS_STATUS=$?
if [ "$PROCESS_STATUS" -ne 0 ]; then
  # Keep whatever earlier files produced: export before reporting the failure.
  npx deepsec export --format json --out "$OUT/findings.json" > "$OUT/export.log" 2>&1 || true
  fail process "$PROCESS_STATUS"
fi
if [ -f "$OUT/budget-usage-unavailable.json" ]; then fail budget_usage_unavailable 1; fi
if [ -f "$OUT/budget-usage-invalid.json" ]; then fail budget_usage_invalid 1; fi

phase exporting
npx deepsec export --format json --out "$OUT/findings.json" > "$OUT/export.log" 2>&1 || fail export $?
phase done
`;

/**
 * Counts Deepsec's per-file records: files with candidates, and files
 * actually investigated. A file whose latest analysis reports it skipped
 * (the agent could not read it) does not count, so a scan never reports
 * coverage it did not get.
 */
export const PROGRESS_SCRIPT = `
const fs = require("fs"), path = require("path");
let tracked = 0, selected = 0, analyzed = 0, sourceCandidates = 0;
let candidateFindings = 0, machineRevalidatedFindings = 0, rejectedFindings = 0;
let available = true, sourceFiles = null, reviewMode = null;
const investigated = (record) => {
  if (record.status !== "analyzed") return false;
  const latest = (record.analysisHistory || []).at(-1);
  const skipped = latest && latest.refusal && latest.refusal.skipped;
  return !(Array.isArray(skipped) && skipped.length > 0);
};
const rejected = new Set(["false-positive", "fixed", "duplicate", "accepted-risk"]);
const FILE_CAP = 300;
const files = [];
const root = process.argv[1];
const recordPath = (record, file) => {
  for (const key of ["relativePath", "path", "filePath", "file"]) {
    if (typeof record[key] === "string" && record[key]) return record[key];
  }
  return path.relative(root, file).replace(/\\.json$/, "");
};
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith(".json")) {
      try {
        const record = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!record || typeof record !== "object" || !Array.isArray(record.candidates) || !Array.isArray(record.findings) || !Array.isArray(record.analysisHistory)) throw new Error("invalid Deepsec file record");
        tracked++;
        if (record.candidates.length > 0) {
          selected++;
          if (files.length < FILE_CAP) {
            const latest = record.analysisHistory.at(-1);
            const skippedList = latest && latest.refusal && latest.refusal.skipped;
            const status = record.status !== "analyzed" ? "pending" : Array.isArray(skippedList) && skippedList.length > 0 ? "skipped" : "investigated";
            files.push({ path: recordPath(record, file), status });
          }
        }
        sourceCandidates += record.candidates.length;
        if (record.candidates.length > 0 && investigated(record)) analyzed++;
        for (const finding of record.findings) {
          const verdict = finding && finding.revalidation && finding.revalidation.verdict;
          if (verdict === "true-positive") machineRevalidatedFindings++;
          else if (rejected.has(verdict)) rejectedFindings++;
          else candidateFindings++;
        }
      } catch { available = false; }
    }
  }
};
try { sourceFiles = Number(fs.readFileSync(path.join(process.argv[2], "source-files.txt"), "utf8").trim()); if (!Number.isFinite(sourceFiles) || sourceFiles < 0) sourceFiles = null; } catch {}
try { const value = fs.readFileSync(path.join(process.argv[2], "fallback-mode.txt"), "utf8").trim(); if (value === "built-in" || value === "fallback") reviewMode = value; } catch {}
try { walk(process.argv[1]); } catch (error) { if (!error || error.code !== "ENOENT") available = false; }
files.sort((a, b) => a.path.localeCompare(b.path));
process.stdout.write(JSON.stringify({ available, sourceFiles, reviewMode, tracked, selected, analyzed, sourceCandidates, candidateFindings, machineRevalidatedFindings, rejectedFindings, files }));
`;

export const PROGRESS_DIR = `${DEEPSEC_WORKSPACE}/data/${DEEPSEC_PROJECT_ID}/files`;

/** Lockfile names cve.now's check_stack tool can parse. */
export const LOCKFILE_NAMES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "mix.lock",
  "requirements.txt",
];
