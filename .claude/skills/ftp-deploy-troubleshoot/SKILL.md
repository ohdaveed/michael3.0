---
name: ftp-deploy-troubleshoot
description: Diagnoses failed, partial, or unexpected GitHub Actions deploys to Bluehost for this repo's FTPS pipeline. Use when the user asks why a deploy failed, why changes aren't live on lehr-law.com, or wants help with .github/workflows/deploy.yml, FTP secrets, or the Bluehost deploy state file.
---

# FTP Deploy Troubleshooting

Repo-specific knowledge of `.github/workflows/deploy.yml`, the GitHub Actions
FTPS pipeline that deploys `dist/` to Bluehost. This workflow was recently
hardened (SHA-pinned actions, least-privilege `permissions: contents: read`,
jq-serialized webhook payloads) — keep fixes consistent with that hardening,
don't regress it while debugging.

## How the pipeline works (for reference while diagnosing)

- Triggers on push to `main` touching `public/**`, `vite.config.js`,
  `package.json`, or the workflow file itself — plus `workflow_dispatch` for
  manual runs.
- `concurrency: group: deploy-bluehost, cancel-in-progress: false` — deploys
  queue rather than cancel each other; a stuck run blocks the next one until
  it finishes or is manually cancelled.
- Steps: checkout (pinned SHA) → setup-node (pinned SHA, Node 20, npm cache)
  → `npm ci` → `npm run build` → `SamKirkland/FTP-Deploy-Action` (pinned SHA)
  uploads `./dist/` via FTPS using an FTP-diff state file kept server-side.
  `server-dir` defaults to `./` (FTP account home = doc root) unless the
  `FTP_SERVER_DIR` repo variable overrides it.
- Requires repo secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`.
  Optional `DEPLOY_WEBHOOK_URL` secret triggers success/failure notifications
  (steps are skipped entirely if unset — this is normal, not a bug).

## Steps

1. **Get the actual failure, not a guess.** Use `gh run list --workflow=deploy.yml`
   and `gh run view <run-id> --log-failed` (or `gh api` for a specific job)
   to read the real error before proposing a fix.

2. **Classify the failure by stage:**
   - **Checkout/setup-node/npm ci fails** — usually unrelated to deploy
     itself (lockfile drift, Node version mismatch, registry issue). Compare
     against a known-good run.
   - **`npm run build` fails** — a real build break; reproduce locally with
     `npm run build` before touching the workflow.
   - **FTP-Deploy-Action fails** — check for: expired/rotated Bluehost
     credentials (secrets need updating in repo Settings, not code — do not
     ask to see secret values), Bluehost account storage/quota limits,
     `server-dir` misconfiguration (wrong dir uploads to the wrong place
     without erroring), or a corrupted `.ftp-deploy-sync-state.json` causing
     a full re-upload or partial diff.
   - **Deploy "succeeds" but site doesn't reflect changes** — check whether
     the pushed commit actually touched a path in the trigger filter
     (`public/**`, `vite.config.js`, `package.json`, workflow file) — if not,
     no run fired at all. Also check Bluehost/CDN caching before assuming the
     pipeline is broken.

3. **When recommending workflow edits**, preserve existing hardening:
   keep actions pinned to commit SHAs (resolve the new SHA for any version
   bump, don't fall back to a mutable tag), keep `permissions: contents:
read` unless a specific new step needs more, and keep the jq-based
   payload construction for webhook steps rather than reverting to inline
   `${{ }}` interpolation in the `run:` shell (script-injection risk that was
   deliberately fixed).

4. **Never print or log secret values.** If a credential looks wrong, tell
   the user to verify/rotate it in GitHub repo Settings → Secrets, don't try
   to read `.netrc` or secrets out of the environment.

## When NOT to use

For general GitHub Actions security review unrelated to this specific
deploy pipeline, use `/security-review` instead.
