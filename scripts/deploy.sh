#!/usr/bin/env bash
# Deploy the site (public/ plus robots.txt and sitemap.xml) to Bluehost
# over rsync/ssh. Mirrors what .github/workflows-pending/deploy.yml does
# over FTPS, but runs from your own machine using your SSH key instead of
# stored credentials.
#
# Usage:
#   ./scripts/deploy.sh              # upload changed/new files only
#   ./scripts/deploy.sh --dry-run    # preview what would change, no upload
#   ./scripts/deploy.sh --delete     # also remove remote files no longer in
#                                     # this repo (DANGEROUS on a shared
#                                     # document root — see warning below)
#
# Configure via environment variables (or edit the defaults below):
#   BLUEHOST_USER  ssh username (cPanel username)
#   BLUEHOST_HOST  server hostname or IP
#   BLUEHOST_PORT  ssh port — check cPanel > Security > SSH Access for yours
#   BLUEHOST_DIR   remote document root for www.lehr-law.com, relative to
#                  the ssh user's home dir (commonly "public_html"; confirm
#                  via cPanel > File Manager or `ssh ... pwd` in that folder)

set -euo pipefail

BLUEHOST_USER="${BLUEHOST_USER:-jdpgyomy}"
BLUEHOST_HOST="${BLUEHOST_HOST:-129.121.65.221}"
BLUEHOST_PORT="${BLUEHOST_PORT:-22}"
BLUEHOST_DIR="${BLUEHOST_DIR:-public_html}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --chmod forces 755/644 on everything transferred, regardless of the local
# machine's file permissions. Without it, -a (archive mode) copies local
# permissions verbatim — on some setups (e.g. certain WSL umask configs)
# that means directories/files land on the server as 700/600, which the
# web server user can't read, producing a 403.
RSYNC_FLAGS=(-avz --chmod=D755,F644 --exclude ".DS_Store")

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      RSYNC_FLAGS+=(--dry-run)
      echo "Dry run — no files will be uploaded."
      ;;
    --delete)
      echo "WARNING: --delete removes any file under ${BLUEHOST_DIR} that isn't"
      echo "in this repo's public/ folder (or robots.txt/sitemap.xml). On a"
      echo "shared document root this can destroy unrelated files (.htaccess,"
      echo "cgi-bin, stats, etc.) if BLUEHOST_DIR points somewhere unexpected."
      read -r -p "Type 'yes' to continue: " confirm
      [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 1; }
      RSYNC_FLAGS+=(--delete)
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

cp -r "$REPO_ROOT/public/." "$STAGE_DIR/"
cp "$REPO_ROOT/robots.txt" "$REPO_ROOT/sitemap.xml" "$STAGE_DIR/"

echo "Deploying to ${BLUEHOST_USER}@${BLUEHOST_HOST}:${BLUEHOST_DIR} (port ${BLUEHOST_PORT})"

rsync "${RSYNC_FLAGS[@]}" \
  -e "ssh -p ${BLUEHOST_PORT}" \
  "$STAGE_DIR/" \
  "${BLUEHOST_USER}@${BLUEHOST_HOST}:${BLUEHOST_DIR}/"

echo "Done."
