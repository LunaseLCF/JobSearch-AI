import json
import re
import uuid
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import openpyxl

ROOT = Path(r"D:\Users\Admin\WorkBuddy AI\2026-11-17-08-42-30")
XLSX = ROOT / "data" / "Registered_Users.xlsx"
PORT = 3001
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def read_users():
    wb = openpyxl.load_workbook(XLSX)
    ws = wb["Users"]
    users = []
    for row in ws.iter_rows(min_row=2, max_col=6, values_only=True):
        if not row[2]:
            continue
        users.append({
            "id": str(row[0] or ""),
            "name": str(row[1] or ""),
            "email": str(row[2] or ""),
            "password": str(row[3] or ""),
            "registeredAt": str(row[4] or ""),
            "status": str(row[5] or "Active"),
        })
    return users


def write_users(users):
    wb = openpyxl.load_workbook(XLSX)
    ws = wb["Users"]
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, max_col=6):
        for cell in row:
            cell.value = None
    for index, user in enumerate(users, start=2):
        ws.cell(row=index, column=1, value=user["id"])
        ws.cell(row=index, column=2, value=user["name"])
        ws.cell(row=index, column=3, value=user["email"])
        ws.cell(row=index, column=4, value=user["password"])
        ws.cell(row=index, column=5, value=user["registeredAt"])
        ws.cell(row=index, column=6, value=user["status"])
    wb.save(XLSX)


def validate_user(payload, users, current_id=None):
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    status = str(payload.get("status", "Active")) or "Active"
    if len(name) < 2:
        return None, "Please enter a name of at least 2 characters."
    if not EMAIL_RE.match(email):
        return None, "Please enter a valid email address."
    if len(password) < 8:
        return None, "Password must be at least 8 characters."
    if any(u["email"] == email and u["id"] != current_id for u in users):
        return None, "An account with this email already exists."
    if status not in ("Active", "Disabled"):
        return None, "Status must be Active or Disabled."
    return {
        "id": current_id or ("usr_" + uuid.uuid4().hex[:8]),
        "name": name,
        "email": email,
        "password": password,
        "registeredAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "status": status,
    }, None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/users":
            return self.send_json(200, {"ok": True, "users": read_users()})
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            payload = self.read_json()
        except Exception:
            return self.send_json(400, {"ok": False, "error": "Invalid JSON."})

        if path == "/api/users":
            users = read_users()
            user, error = validate_user(payload, users)
            if error:
                return self.send_json(400, {"ok": False, "error": error})
            users.append(user)
            write_users(users)
            return self.send_json(200, {"ok": True, "user": user})

        if path == "/api/login":
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            user = next(
                (u for u in read_users()
                 if u["email"] == email and u["password"] == password and u["status"] == "Active"),
                None,
            )
            if not user:
                return self.send_json(401, {"ok": False, "error": "Invalid email or password."})
            return self.send_json(200, {"ok": True, "user": {
                "id": user["id"], "name": user["name"], "email": user["email"], "status": user["status"]
            }})

        if path == "/api/forgot":
            email = str(payload.get("email", "")).strip().lower()
            if not EMAIL_RE.match(email):
                return self.send_json(400, {"ok": False, "error": "Please enter a valid email address."})
            return self.send_json(200, {"ok": True, "message": "Reset link sent (demo)."})

        return self.send_json(404, {"ok": False, "error": "Not found."})

    def do_PUT(self):
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/users/([A-Za-z0-9_-]+)", path)
        if not match:
            return self.send_json(404, {"ok": False, "error": "Not found."})
        try:
            payload = self.read_json()
        except Exception:
            return self.send_json(400, {"ok": False, "error": "Invalid JSON."})
        users = read_users()
        user_id = match.group(1)
        index = next((i for i, u in enumerate(users) if u["id"] == user_id), None)
        if index is None:
            return self.send_json(404, {"ok": False, "error": "User not found."})
        existing = users[index]
        merged = dict(existing)
        merged.update({k: v for k, v in payload.items() if k in ("name", "email", "password", "status")})
        updated, error = validate_user(merged, users, current_id=user_id)
        if error:
            return self.send_json(400, {"ok": False, "error": error})
        updated["registeredAt"] = existing["registeredAt"]
        users[index] = updated
        write_users(users)
        return self.send_json(200, {"ok": True, "user": updated})

    def do_DELETE(self):
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/users/([A-Za-z0-9_-]+)", path)
        if not match:
            return self.send_json(404, {"ok": False, "error": "Not found."})
        users = read_users()
        user_id = match.group(1)
        remaining = [u for u in users if u["id"] != user_id]
        if len(remaining) == len(users):
            return self.send_json(404, {"ok": False, "error": "User not found."})
        write_users(remaining)
        return self.send_json(200, {"ok": True})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"AI Job Search auth app running at http://127.0.0.1:{PORT}/login.html")
    print(f"Admin panel: http://127.0.0.1:{PORT}/admin.html")
    print(f"Excel store: {XLSX}")
    server.serve_forever()
