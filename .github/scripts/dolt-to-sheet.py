#!/usr/bin/env python3
"""Overwrites the DevLog Dashboard sheet's Sheet1 tab with the current
contents of the git_commits table, sorted newest first.

Reads the Dolt table as CSV from stdin (see dolt-sync-commits.sh) and the
service account key path / sheet id from environment variables:
  GOOGLE_SHEETS_SA_KEY_FILE, DEVLOG_SHEET_ID
"""
import csv
import io
import os
import sys

import google.auth.transport.requests
import requests
from google.oauth2 import service_account

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
SHEET_TAB = "Sheet1"
HEADER = ["commit_hash", "author_name", "author_email", "commit_date", "message"]


def main():
    key_file = os.environ["GOOGLE_SHEETS_SA_KEY_FILE"]
    sheet_id = os.environ["DEVLOG_SHEET_ID"]

    reader = csv.DictReader(io.StringIO(sys.stdin.read()))
    rows = sorted(reader, key=lambda r: r["commit_date"], reverse=True)

    values = [HEADER] + [[r[col] for col in HEADER] for r in rows]

    creds = service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)
    creds.refresh(google.auth.transport.requests.Request())
    headers = {"Authorization": f"Bearer {creds.token}", "Content-Type": "application/json"}

    # Clear the tab first so a shrinking row count doesn't leave stale rows behind.
    clear_resp = requests.post(
        f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{SHEET_TAB}:clear",
        headers=headers,
    )
    clear_resp.raise_for_status()

    update_resp = requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{SHEET_TAB}!A1",
        headers=headers,
        params={"valueInputOption": "RAW"},
        json={"values": values},
    )
    update_resp.raise_for_status()

    print(f"Wrote {len(rows)} commit row(s) to {SHEET_TAB}.")


if __name__ == "__main__":
    main()
