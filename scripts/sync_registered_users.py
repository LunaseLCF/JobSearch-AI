"""Sync Registered_Users.xlsx with the app's auth store and enrich the workbook
with the user-level (plan) details used for access control and future billing.

Usage:
  python scripts/sync_registered_users.py
  python scripts/sync_registered_users.py --reset-passwords
  python scripts/sync_registered_users.py --level user@example.com=pro

The Excel file is the human-readable registry; data/users.json is the live
auth store used by the Node server. This script keeps both in step.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
from datetime import datetime
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "Registered_Users.xlsx"
USERS_JSON = ROOT / "data" / "users.json"
USER_DATA_ROOT = ROOT / "data" / "users"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

LEVEL_ALIASES = {
    "free": "free", "free member": "free", "basic": "free",
    "pro": "pro", "professional": "pro", "paid": "pro",
    "team": "team", "business": "team", "organisation": "team", "organization": "team",
    "owner": "owner", "admin": "owner", "administrator": "owner", "super": "owner",
}

LEVEL_SHEET_ROWS = [
    ["Level", "Suggested price", "Pages unlocked", "AI / API features", "Monthly limits", "Best for", "Notes"],
    ["Public", "Free", "Landing, Sign in, Register", "None", "N/A", "Visitors evaluating the product",
     "No account required; cannot read or write any personal data."],
    ["Free", "0", "Dashboard, Profile, Search, Evaluate, Tracker, Salary Lookup (limited), Reports",
     "Resume upload/parsing only", "20 resume parses/month", "New users building a habit",
     "AI tailoring, Interview Prep, LLM Config and Repo Browser are locked."],
    ["Pro", "USD 29 / month", "Everything in Free + Apply, Interview Prep, LLM Config, full Salary Lookup, report export",
     "AI resume tailoring, AI interview prep, bring-your-own LLM key, exports",
     "300 AI calls/month, 500 resume parses/month, 500 exports/month", "Job seekers actively applying",
     "Main monetisation tier. API keys are per user and stored in that user's workspace."],
    ["Team", "USD 99 / month", "Everything in Pro + Repo Browser, shared templates, team analytics",
     "Everything in Pro + internal repository access",
     "3,000 AI calls/month, 5,000 resume parses/month, 5,000 repo calls/month", "Careers teams and agencies",
     "Designed for multiple seats under one organisation."],
    ["Owner", "Not sold", "Everything", "Everything, plus user management", "Unlimited",
     "System administrator", "Bootstrap account admin@local.app and accounts explicitly set to Owner."],
]

LIMIT_SHEET_ROWS = [
    ["Feature", "API route", "Public", "Free", "Pro", "Team", "Owner"],
    ["Sign in / register", "/api/auth/login, /api/auth/register", "Yes", "Yes", "Yes", "Yes", "Yes"],
    ["View/edit own profile", "/api/profile", "No", "Yes", "Yes", "Yes", "Yes"],
    ["Job search & tracker", "/api/search, /api/tracker", "No", "Yes", "Yes", "Yes", "Yes"],
    ["Salary lookup", "/api/salary", "No", "Limited", "Full", "Full", "Full"],
    ["Resume parsing", "/api/upload-resume, /api/analyze-resume", "No", "20/month", "500/month", "5,000/month", "Unlimited"],
    ["AI resume tailoring", "/api/tailor-resume", "No", "No", "300/month", "3,000/month", "Unlimited"],
    ["AI interview prep", "/api/interview-prep", "No", "No", "300/month", "3,000/month", "Unlimited"],
    ["LLM configuration", "/api/llm-config, /api/llm-test", "No", "No", "Yes", "Yes", "Yes"],
    ["Repo browser", "/api/repo-files", "No", "No", "No", "5,000/month", "Unlimited"],
    ["CV / cover letter / report export", "/api/generate-cv, /api/html-report", "No", "No", "500/month", "3,000/month", "Unlimited"],
]


def hash_password(password, salt=None):
    """Match server/auth.js: salt is a hex STRING used as UTF-8 bytes."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(
        str(password).encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    ).hex()
    return f"{salt}:{digest}"


def normalise_level(value):
    key = str(value or "").strip().lower()
    return LEVEL_ALIASES.get(key, "free")


def style_sheet(ws, widths):
    header_fill = PatternFill("solid", fgColor="1F3A5F")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = Font(bold=True, color="FFFFFF")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset-passwords", action="store_true",
                        help="Overwrite stored password hashes with the plain passwords in Excel.")
    parser.add_argument("--level", action="append", default=[], metavar="EMAIL=LEVEL",
                        help="Set the level for a registered user, e.g. --level me@example.com=pro")
    parser.add_argument("--output", default=None,
                        help="Write the workbook to a different path (useful while the original is open in Excel).")
    args = parser.parse_args()

    output_path = Path(args.output).resolve() if args.output else XLSX
    wb = openpyxl.load_workbook(XLSX)
    ws = wb["Users"]

    headers = [cell.value for cell in ws[1]]
    level_col = headers.index("User Level") + 1 if "User Level" in headers else ws.max_column + 1
    if "User Level" not in headers:
        ws.cell(row=1, column=level_col, value="User Level")
        ws.cell(row=1, column=level_col).font = Font(bold=True)

    level_overrides = {}
    for item in args.level:
        if "=" in item:
            email, level = item.split("=", 1)
            level_overrides[email.strip().lower()] = normalise_level(level)

    rows = []
    for row_num in range(2, ws.max_row + 1):
        email = str(ws.cell(row=row_num, column=3).value or "").strip().lower()
        if not email or not EMAIL_RE.match(email):
            continue
        current = str(ws.cell(row=row_num, column=level_col).value or "").strip()
        level = level_overrides.get(email) or (normalise_level(current) if current else "free")
        ws.cell(row=row_num, column=level_col, value=level.capitalize())
        rows.append({
            "id": str(ws.cell(row=row_num, column=1).value or "").strip(),
            "name": str(ws.cell(row=row_num, column=2).value or "").strip(),
            "email": email,
            "password": str(ws.cell(row=row_num, column=4).value or "").strip(),
            "registeredAt": str(ws.cell(row=row_num, column=5).value or "").strip(),
            "status": str(ws.cell(row=row_num, column=6).value or "Active").strip(),
            "level": level,
        })
    ws.column_dimensions[get_column_letter(level_col)].width = 14

    # Rebuild the reference sheets so the workbook always documents current levels.
    for name in ("User Levels", "API Limits"):
        if name in wb.sheetnames:
            del wb[name]
    level_ws = wb.create_sheet("User Levels")
    for row in LEVEL_SHEET_ROWS:
        level_ws.append(row)
    style_sheet(level_ws, [12, 18, 46, 46, 44, 34, 60])
    limit_ws = wb.create_sheet("API Limits")
    for row in LIMIT_SHEET_ROWS:
        limit_ws.append(row)
    style_sheet(limit_ws, [32, 48, 12, 14, 14, 16, 14])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)

    # Merge the registry into the live auth store.
    users = {}
    if USERS_JSON.exists():
        try:
            users = json.loads(USERS_JSON.read_text(encoding="utf-8"))
        except Exception:
            users = {}
    by_email = {str(u.get("email", "")).lower(): uid for uid, u in users.items()}

    for row in rows:
        uid = by_email.get(row["email"]) or row["id"] or ("user_" + secrets.token_hex(6))
        existing = users.get(uid, {})
        created_at = row["registeredAt"]
        try:
            created_at = datetime.strptime(created_at, "%Y-%m-%d %H:%M").isoformat() + "Z"
        except Exception:
            created_at = existing.get("createdAt") or datetime.utcnow().isoformat() + "Z"
        user = dict(existing)
        user.update({
            "id": uid,
            "email": row["email"],
            "name": row["name"] or existing.get("name") or row["email"].split("@")[0],
            "plan": row["level"],
            "createdAt": created_at,
        })
        if args.reset_passwords or not user.get("passwordHash"):
            if row["password"]:
                user["passwordHash"] = hash_password(row["password"])
        users[uid] = user
        by_email[row["email"]] = uid
        USER_DATA_ROOT.joinpath(uid).mkdir(parents=True, exist_ok=True)

    USERS_JSON.parent.mkdir(parents=True, exist_ok=True)
    USERS_JSON.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Updated {output_path}")
    print(f"Synced {len(rows)} Excel user(s) into {USERS_JSON}")
    for row in rows:
        print(f"  {row['email']:<36} level={row['level']:<6} status={row['status']}")


if __name__ == "__main__":
    main()
