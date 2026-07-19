#!/usr/bin/env python3
"""Update the personal billable-hours CSVs at the repo root.

Three independent, idempotent passes:
  - site hours   (git commit history)       -> hours-worked-*.csv
  - business tools (Chrome/Edge history)     -> business-tools-*.csv, quo-hours-*.csv
  - AI work (Claude Code CLI transcripts)    -> ai-hours-*.csv

Each pass resumes from the last timestamp already recorded in its CSV, so
re-running this script never duplicates a session. All CSVs it touches are
gitignored (see .gitignore) -- this is personal billing data, not site
content.

Usage:
    uv run python scripts/hours/calculate_hours.py [--dry-run]
"""

import argparse
import csv
import datetime
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from collections import defaultdict
from urllib.parse import urlparse

REPO_ROOT = subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
).stdout.strip()

GAP_MIN = 30
END_PAD_SEC = 300

# WSL paths to the Windows Chrome/Edge profile. Override with env vars if
# the Windows username or profile differs from this machine's default.
WIN_USER = os.environ.get("HOURS_WIN_USER", "david")
CHROME_HISTORY = os.environ.get(
    "HOURS_CHROME_HISTORY",
    f"/mnt/c/Users/{WIN_USER}/AppData/Local/Google/Chrome/User Data/Default/History",
)
EDGE_HISTORY = os.environ.get(
    "HOURS_EDGE_HISTORY",
    f"/mnt/c/Users/{WIN_USER}/AppData/Local/Microsoft/Edge/User Data/Default/History",
)

# Claude Code CLI transcripts for this repo (project dir name is the repo
# path with slashes and dots turned into dashes).
CLAUDE_PROJECT_SLUG = REPO_ROOT.replace("/", "-").replace(".", "-")
CLAUDE_PROJECTS_DIR = os.path.expanduser(f"~/.claude/projects/{CLAUDE_PROJECT_SLUG}")

CHROME_EPOCH = datetime.datetime(1601, 1, 1)


# --- shared session-clustering engine ---------------------------------

def sessionize(events, gap_min=GAP_MIN, end_pad_sec=END_PAD_SEC):
    """events: sorted list of datetimes (or (dt, extra) tuples). Splits on
    idle gaps > gap_min and pads each session's end by end_pad_sec, matching
    the convention already used across this repo's hours CSVs."""
    sessions, cur, prev = [], [], None
    for item in events:
        dt = item[0] if isinstance(item, tuple) else item
        if prev and (dt - prev).total_seconds() > gap_min * 60:
            sessions.append(cur)
            cur = []
        cur.append(item)
        prev = dt
    if cur:
        sessions.append(cur)
    out = []
    for s in sessions:
        start = s[0][0] if isinstance(s[0], tuple) else s[0]
        last = s[-1][0] if isinstance(s[-1], tuple) else s[-1]
        end = last + datetime.timedelta(seconds=end_pad_sec)
        out.append({"start": start, "end": end, "count": len(s), "items": s})
    return out


def csv_rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path, header, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)


# --- 1. site hours (git commit history) --------------------------------

def parse_dt(d, t):
    return datetime.datetime.strptime(f"{d} {t}", "%Y-%m-%d %H:%M:%S")


def parse_span(date_str, start_str, end_str):
    """Parse a (date, start_time, end_time) row back into real datetimes,
    rolling end onto the next day if the session crossed midnight (stored
    end_time < start_time on the same date string)."""
    start = parse_dt(date_str, start_str)
    end = parse_dt(date_str, end_str)
    if end < start:
        end += datetime.timedelta(days=1)
    return start, end


def last_site_cutoff(rows):
    if not rows:
        return None
    last = rows[-1]
    start, end = parse_span(last["date"], last["start_time"], last["end_time"])
    # single-commit sessions pad end_time by 30min; the real cutoff is the
    # commit itself (start). Multi-commit sessions are unpadded.
    return start if last["commit_count"] == "1" else end


def update_site_hours(dry_run):
    detailed_path = os.path.join(REPO_ROOT, "hours-worked-detailed.csv")
    summary_path = os.path.join(REPO_ROOT, "hours-worked-summary.csv")
    last5_path = os.path.join(REPO_ROOT, "hours-worked-last5days.csv")

    existing = csv_rows(detailed_path)
    cutoff = last_site_cutoff(existing)
    since_arg = cutoff.strftime("%Y-%m-%d %H:%M:%S") if cutoff else "1970-01-01"

    log = subprocess.run(
        ["git", "-C", REPO_ROOT, "log", f"--since={since_arg}",
         "--date=format:%Y-%m-%d %H:%M:%S", "--pretty=format:%ad|%s%n"],
        capture_output=True, text=True, check=True,
    ).stdout

    commits = []
    for line in log.splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        ts, subj = line.split("|", 1)
        dt = datetime.datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
        if cutoff and dt <= cutoff:
            continue
        commits.append((dt, subj))
    commits.sort(key=lambda c: c[0])

    if not commits:
        print("[site] no new commits since last recorded session")
        return

    sessions = sessionize(commits)
    new_rows = []
    for s in sessions:
        start, last = s["start"], (s["items"][-1][0])
        end = start + datetime.timedelta(minutes=30) if s["count"] == 1 else last
        dur = round((end - start).total_seconds() / 3600, 2)
        subjs = "; ".join(subj for _, subj in s["items"])
        new_rows.append([start.date().isoformat(), start.strftime("%H:%M:%S"),
                          end.strftime("%H:%M:%S"), dur, s["count"], subjs])

    print(f"[site] {len(new_rows)} new session(s) since {since_arg}")
    if dry_run:
        for r in new_rows:
            print("  ", r[:5])
        return

    all_rows = [[r["date"], r["start_time"], r["end_time"], r["duration_hours"],
                 r["commit_count"], r["description"]] for r in existing] + new_rows
    write_csv(detailed_path, ["date", "start_time", "end_time", "duration_hours",
                              "commit_count", "description"], all_rows)

    byday = defaultdict(lambda: [0.0, 0])
    for r in all_rows:
        byday[r[0]][0] += float(r[3])
        byday[r[0]][1] += int(r[4])
    write_csv(summary_path, ["date", "hours", "commit_count"],
              [[d, round(h, 2), c] for d, (h, c) in sorted(byday.items())])

    last5 = sorted(byday.items())[-5:]
    write_csv(last5_path, ["date", "hours", "commit_count", "notes"],
              [[d, round(h, 2), c, ""] for d, (h, c) in last5])
    print(f"[site] wrote {detailed_path}, {summary_path}, {last5_path}")


# --- 2. business tools (Chrome/Edge browser history) --------------------

CATEGORIES = {
    "Calendly (client scheduling)": (["calendly.com"], []),
    "Tally.so form builder": (["tally.so"], []),
    "Fillout/Zite (client onboarding forms)": (["fillout.com", "zite-sandbox.com"], []),
    "Microsoft Bookings": (["bookings.cloud.microsoft"], []),
    "SharePoint/Outlook (Lehr Law tenant)": (
        ["sharepoint.com", "outlook.office.com", "outlook.office365.com", "office.com"],
        ["sfgov1-my.sharepoint.com", "sfgov1.sharepoint.com"],
    ),
    "Automation platform research": (["make.com", "quo.com"], []),
    "Web3Forms (legacy form svc)": (["web3forms.com"], []),
    "Clio (legal practice mgmt)": (["clio.com"], []),
    "Hosting/cPanel admin": (["webpros.com", "cpanel.net", "cpanel.zendesk.com", "bluehost.com"], []),
    "Railway": (["railway.com", "railway.app"], []),
}

CAT_LABEL = {
    "Automation platform research": "Automation research",
    "Calendly (client scheduling)": "Calendly",
    "Microsoft Bookings": "MS Bookings",
    "Tally.so form builder": "Tally.so",
    "Web3Forms (legacy form svc)": "Web3Forms",
    "Hosting/cPanel admin": "Hosting/cPanel",
    "Clio (legal practice mgmt)": "Clio",
    "Fillout/Zite (client onboarding forms)": "Fillout/Zite",
    "SharePoint/Outlook (Lehr Law tenant)": "SharePoint/Outlook",
    "Railway": "Railway",
}


def host_matches(netloc, suffixes):
    return any(netloc == s or netloc.endswith("." + s) for s in suffixes)


def load_browser_visits():
    visits = []
    with tempfile.TemporaryDirectory() as tmp:
        for src in (CHROME_HISTORY, EDGE_HISTORY):
            if not os.path.exists(src):
                continue
            dst = os.path.join(tmp, os.path.basename(src) + str(len(visits)))
            shutil.copy2(src, dst)  # copy first: the live file is locked while the browser runs
            con = sqlite3.connect(dst)
            cur = con.cursor()
            cur.execute("SELECT v.visit_time, u.url FROM visits v JOIN urls u ON v.url = u.id")
            for ts, url in cur.fetchall():
                dt = CHROME_EPOCH + datetime.timedelta(microseconds=ts)
                visits.append((dt, url))
            con.close()
    visits.sort(key=lambda r: r[0])
    return visits


def last_category_cutoff(rows, category):
    cat_rows = [r for r in rows if r["category"] == category]
    if not cat_rows:
        return None
    spans = [parse_span(r["date"], r["start_time_utc"], r["end_time_utc"]) for r in cat_rows]
    _, end = max(spans, key=lambda s: s[1])
    # end_time_utc is always padded by END_PAD_SEC; the real cutoff is 5 min earlier.
    return end - datetime.timedelta(seconds=END_PAD_SEC)


def update_business_tools(dry_run):
    by_cat_path = os.path.join(REPO_ROOT, "business-tools-by-category.csv")
    summary_path = os.path.join(REPO_ROOT, "business-tools-category-summary.csv")
    merged_detailed_path = os.path.join(REPO_ROOT, "business-tools-merged-detailed.csv")
    merged_daily_path = os.path.join(REPO_ROOT, "business-tools-merged-daily.csv")

    if not os.path.exists(CHROME_HISTORY) and not os.path.exists(EDGE_HISTORY):
        print("[business-tools] no browser history found (check HOURS_WIN_USER); skipping")
        return

    existing = csv_rows(by_cat_path)
    visits = load_browser_visits()
    print(f"[business-tools] {len(visits)} total browser visits loaded")

    new_rows = []
    for cat, (suffixes, excl) in CATEGORIES.items():
        cutoff = last_category_cutoff(existing, cat)
        filtered = []
        for dt, url in visits:
            if cutoff and dt.replace(microsecond=0) <= cutoff:
                continue
            netloc = urlparse(url).netloc
            if host_matches(netloc, suffixes) and netloc not in excl:
                filtered.append((dt, netloc))
        for s in sessionize(filtered):
            dur = round((s["end"] - s["start"]).total_seconds() / 3600, 2)
            new_rows.append({
                "category": cat, "date": s["start"].date().isoformat(),
                "start_time_utc": s["start"].strftime("%H:%M:%S"),
                "end_time_utc": s["end"].strftime("%H:%M:%S"),
                "duration_hours": str(dur), "pageviews": str(s["count"]),
            })

    if not new_rows:
        print("[business-tools] no new sessions in any category")
        return
    print(f"[business-tools] {len(new_rows)} new session(s) across "
          f"{len({r['category'] for r in new_rows})} categories")
    if dry_run:
        for r in new_rows:
            print("  ", r)
        return

    all_rows = existing + new_rows
    write_csv(by_cat_path, ["category", "date", "start_time_utc", "end_time_utc",
                            "duration_hours", "pageviews"],
              [[r["category"], r["date"], r["start_time_utc"], r["end_time_utc"],
                r["duration_hours"], r["pageviews"]] for r in all_rows])

    cat_stats = defaultdict(lambda: [0, 0, 0.0])
    for r in all_rows:
        c = r["category"]
        cat_stats[c][0] += int(r["pageviews"])
        cat_stats[c][1] += 1
        cat_stats[c][2] += float(r["duration_hours"])
    write_csv(summary_path, ["category", "total_pageviews", "sessions", "total_hours"],
              [[c, pv, sess, round(hrs, 2)] for c, (pv, sess, hrs) in cat_stats.items()])

    # cross-category merge (union of overlapping intervals across all categories)
    intervals = sorted(
        [(*parse_span(r["date"], r["start_time_utc"], r["end_time_utc"]),
          CAT_LABEL.get(r["category"], r["category"]), int(r["pageviews"])) for r in all_rows],
        key=lambda x: x[0],
    )
    merged = []
    for start, end, cat, pv in intervals:
        if merged and start <= merged[-1]["end"]:
            m = merged[-1]
            m["end"] = max(m["end"], end)
            m["pv"] += pv
            if cat not in m["cats"]:
                m["cats"].append(cat)
        else:
            merged.append({"start": start, "end": end, "pv": pv, "cats": [cat]})

    merged_rows = []
    for m in merged:
        dur = round((m["end"] - m["start"]).total_seconds() / 3600, 2)
        merged_rows.append([m["start"].date().isoformat(), m["start"].strftime("%H:%M:%S"),
                             m["end"].strftime("%H:%M:%S"), dur, m["pv"], ";".join(m["cats"])])
    write_csv(merged_detailed_path, ["date", "start_time", "end_time", "duration_hours",
                                      "pageviews", "categories"], merged_rows)

    byday = defaultdict(float)
    for r in merged_rows:
        byday[r[0]] += r[3]
    write_csv(merged_daily_path, ["date", "hours"],
              [[d, round(h, 2)] for d, h in sorted(byday.items())])
    print(f"[business-tools] wrote {by_cat_path}, {summary_path}, "
          f"{merged_detailed_path}, {merged_daily_path}")

    # quo-hours-*.csv: standalone quo.com-only view, kept separately from the
    # broader "Automation platform research" category (which also covers make.com).
    update_quo_hours(visits, dry_run)


def update_quo_hours(visits, dry_run):
    detailed_path = os.path.join(REPO_ROOT, "quo-hours-detailed.csv")
    summary_path = os.path.join(REPO_ROOT, "quo-hours-summary.csv")
    existing = csv_rows(detailed_path)
    cutoff = None
    if existing:
        last = existing[-1]
        _, end = parse_span(last["date"], last["start_time"], last["end_time"])
        cutoff = end - datetime.timedelta(seconds=END_PAD_SEC)

    filtered = []
    for dt, url in visits:
        if cutoff and dt.replace(microsecond=0) <= cutoff:
            continue
        netloc = urlparse(url).netloc
        if host_matches(netloc, ["quo.com"]):
            filtered.append((dt, netloc))

    new_sessions = sessionize(filtered)
    if not new_sessions:
        return
    new_rows = []
    for s in new_sessions:
        dur = round((s["end"] - s["start"]).total_seconds() / 3600, 2)
        hosts = sorted(set(h for _, h in s["items"]))
        new_rows.append([s["start"].date().isoformat(), s["start"].strftime("%H:%M:%S"),
                          s["end"].strftime("%H:%M:%S"), dur, s["count"], ";".join(hosts)])
    print(f"[quo] {len(new_rows)} new session(s)")
    if dry_run:
        return

    all_rows = [[r["date"], r["start_time"], r["end_time"], r["duration_hours"],
                 r["pageviews"], r["domains"]] for r in existing] + new_rows
    write_csv(detailed_path, ["date", "start_time", "end_time", "duration_hours",
                              "pageviews", "domains"], all_rows)
    byday = defaultdict(lambda: [0.0, 0])
    for r in all_rows:
        byday[r[0]][0] += float(r[3])
        byday[r[0]][1] += int(r[4])
    write_csv(summary_path, ["date", "hours", "pageviews"],
              [[d, round(h, 2), pv] for d, (h, pv) in sorted(byday.items())])


# --- 3. AI work (Claude Code CLI transcripts, this repo) ----------------

def update_ai_hours(dry_run):
    detailed_path = os.path.join(REPO_ROOT, "ai-hours-detailed.csv")
    summary_path = os.path.join(REPO_ROOT, "ai-hours-summary.csv")

    if not os.path.isdir(CLAUDE_PROJECTS_DIR):
        print(f"[ai] no transcripts dir at {CLAUDE_PROJECTS_DIR}; skipping")
        return

    existing = csv_rows(detailed_path)
    cutoff = None
    if existing:
        last = existing[-1]
        _, end = parse_span(last["date"], last["start_time"], last["end_time"])
        cutoff = end - datetime.timedelta(seconds=END_PAD_SEC)

    events = []
    for path in glob.glob(os.path.join(CLAUDE_PROJECTS_DIR, "*.jsonl")):
        with open(path, errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = obj.get("timestamp")
                if not ts:
                    continue
                try:
                    dt = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ")
                except ValueError:
                    try:
                        dt = datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
                    except ValueError:
                        continue
                if cutoff and dt.replace(microsecond=0) <= cutoff:
                    continue
                events.append(dt)
    events.sort()

    if not events:
        print("[ai] no new transcript events")
        return
    sessions = sessionize(events)
    new_rows = []
    for s in sessions:
        dur = round((s["end"] - s["start"]).total_seconds() / 3600, 2)
        new_rows.append([s["start"].date().isoformat(), s["start"].strftime("%H:%M:%S"),
                          s["end"].strftime("%H:%M:%S"), dur, s["count"]])
    print(f"[ai] {len(new_rows)} new session(s)")
    if dry_run:
        return

    all_rows = [[r["date"], r["start_time"], r["end_time"], r["duration_hours"],
                 r["event_count"]] for r in existing] + new_rows
    write_csv(detailed_path, ["date", "start_time", "end_time", "duration_hours",
                              "event_count"], all_rows)
    byday = defaultdict(lambda: [0.0, 0])
    for r in all_rows:
        byday[r[0]][0] += float(r[3])
        byday[r[0]][1] += int(r[4])
    write_csv(summary_path, ["date", "hours", "event_count"],
              [[d, round(h, 2), c] for d, (h, c) in sorted(byday.items())])
    print(f"[ai] wrote {detailed_path}, {summary_path}")


# --- summary report ------------------------------------------------------

def load_daily(path):
    """date -> summed hours, from a CSV with date,hours[,...] columns."""
    out = defaultdict(float)
    for r in csv_rows(path):
        out[r["date"]] += float(r["hours"])
    return out


def print_summary(days):
    """Site (includes AI-assisted work -- not billed as a separate service
    since AI credits are paid for directly) vs. Business Tools, per day."""
    end = datetime.date.today()
    start = (end - datetime.timedelta(days=days - 1)).isoformat()
    end = end.isoformat()

    site = load_daily(os.path.join(REPO_ROOT, "hours-worked-summary.csv"))
    ai = load_daily(os.path.join(REPO_ROOT, "ai-hours-summary.csv"))
    biz = load_daily(os.path.join(REPO_ROOT, "business-tools-merged-daily.csv"))

    combined_site = defaultdict(float)
    for d, h in site.items():
        combined_site[d] += h
    for d, h in ai.items():
        combined_site[d] += h

    all_dates = sorted(d for d in set(combined_site) | set(biz) if start <= d <= end)

    print(f"\n=== billable hours: {start} to {end} ===")
    print(f"{'date':12}{'site':>8}{'business':>10}{'total':>8}")
    grand_site, grand_biz = 0.0, 0.0
    for d in all_dates:
        s, b = round(combined_site.get(d, 0.0), 2), round(biz.get(d, 0.0), 2)
        grand_site += s
        grand_biz += b
        print(f"{d:12}{s:8.2f}{b:10.2f}{s + b:8.2f}")
    print("-" * 38)
    print(f"{'TOTAL':12}{grand_site:8.2f}{grand_biz:10.2f}{grand_site + grand_biz:8.2f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                         help="print what would change without writing any CSVs")
    parser.add_argument("--days", type=int, default=30,
                         help="how many trailing days the summary report covers (default 30)")
    args = parser.parse_args()

    update_site_hours(args.dry_run)
    update_business_tools(args.dry_run)
    update_ai_hours(args.dry_run)

    if not args.dry_run:
        print_summary(args.days)


if __name__ == "__main__":
    sys.exit(main())
