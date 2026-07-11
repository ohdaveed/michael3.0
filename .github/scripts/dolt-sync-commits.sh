#!/usr/bin/env bash
# Syncs new git commits on this repo into the DoltHub git_commits table.
# Expects: dolt CLI on PATH and authenticated (DOLTHUB creds already configured),
# and to be run from the root of the michael3.0 git checkout.
set -euo pipefail

DOLT_REMOTE="ohdaveed/lehr-law-changes"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

dolt clone "$DOLT_REMOTE" "$WORKDIR/lehr-law-changes"
cd "$WORKDIR/lehr-law-changes"

dolt sql -q "SELECT commit_hash FROM git_commits" -r csv | tail -n +2 > known_hashes.txt

python3 - "$OLDPWD" known_hashes.txt new_commits.csv <<'PYEOF'
import csv
import subprocess
import sys

repo_dir, known_path, out_path = sys.argv[1:4]

with open(known_path, encoding="utf-8") as f:
    known = {line.strip() for line in f if line.strip()}

log = subprocess.run(
    ["git", "-C", repo_dir, "log", "--pretty=format:%H%x1f%an%x1f%ae%x1f%aI%x1f%s"],
    capture_output=True, text=True, check=True,
).stdout

rows = []
for line in log.splitlines():
    parts = line.split("\x1f")
    if len(parts) != 5:
        continue
    commit_hash = parts[0]
    if commit_hash in known:
        continue
    rows.append(parts)

with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["commit_hash", "author_name", "author_email", "commit_date", "message"])
    w.writerows(rows)

print(f"{len(rows)} new commit(s) to sync")
PYEOF

NEW_COUNT=$(($(wc -l < new_commits.csv) - 1))

if [ "$NEW_COUNT" -le 0 ]; then
  echo "No new commits to sync."
  exit 0
fi

dolt table import -u git_commits new_commits.csv
dolt add git_commits
dolt commit -m "Sync ${NEW_COUNT} new commit(s) from GitHub Actions run ${GITHUB_RUN_ID:-manual}"
dolt push origin main

echo "Synced ${NEW_COUNT} new commit(s) to DoltHub."
