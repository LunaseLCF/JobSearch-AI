"""Write the live auth store (data/users.json) back into the Users sheet of the
registered-users workbook, keeping the User Levels / API Limits reference sheets.

Called by the owner admin API after a user is created, updated or removed.
"""

import json
import shutil
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
USERS_JSON = ROOT / "data" / "users.json"
PRIMARY = ROOT / "data" / "Registered_Users.xlsx"
MIRROR = ROOT / "data" / "Registered_Users_With_Levels.xlsx"


def main():
    users = {}
    if USERS_JSON.exists():
        users = json.loads(USERS_JSON.read_text(encoding="utf-8"))

    target = MIRROR if MIRROR.exists() else PRIMARY
    wb = openpyxl.load_workbook(target)
    ws = wb["Users"] if "Users" in wb.sheetnames else wb.create_sheet("Users", 0)

    headers = [cell.value for cell in ws[1]]
    wanted = ["ID", "Name", "Email", "Password", "Registered At", "Status", "User Level"]
    if headers != wanted:
        for index, value in enumerate(wanted, start=1):
            ws.cell(row=1, column=index, value=value)

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=len(wanted)):
        for cell in row:
            cell.value = None

    for index, user in enumerate(users.values(), start=2):
        created = str(user.get("createdAt", "")).replace("T", " ")[:16]
        values = [
            user.get("id", ""),
            user.get("name", ""),
            user.get("email", ""),
            "(hashed in users.json)",
            created,
            user.get("status", "Active"),
            str(user.get("plan", "free")).capitalize(),
        ]
        for column, value in enumerate(values, start=1):
            ws.cell(row=index, column=column, value=value)

    try:
        wb.save(PRIMARY)
        saved = PRIMARY
    except PermissionError:
        wb.save(MIRROR)
        saved = MIRROR
    print(f"Exported {len(users)} user(s) to {saved}")


if __name__ == "__main__":
    main()
