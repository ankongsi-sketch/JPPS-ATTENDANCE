# JPPS Attendance System

Mobile attendance check-in for Jabatan Perkhidmatan Pembetungan Sarawak, built from design **2a** in `project/Attendance System.dc.html`, with the meeting history from **1a** added to Admin.

## Run

Requires Node.js 22.13 or later (uses the built-in `node:sqlite`).

```bash
cd app
npm install
ADMIN_PASSWORD='choose-a-strong-password' npm start   # http://localhost:3000
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `admin` (dev only; required when `NODE_ENV=production`) | Secretariat login |
| `SESSION_SECRET` | derived from the password | Signs the admin cookie |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `app/data/attendance.db` | SQLite file. Put it on a persistent disk when deploying. |
| `PUBLIC_URL` | request host | Base URL encoded in the QR codes, e.g. `https://hadir.jpps.example` |
| `TZ_NAME` | `Asia/Kuching` | Time zone for recorded dates and times |

Serve it over HTTPS in production, behind a reverse proxy or on a PaaS such as Render or Railway with a persistent disk for `DB_PATH`.

## How it works

- **Participants** scan the program's QR code, which opens `/?p=<id>`. The bare `/` opens the *current* program. They choose Present or Absent, enter the 4-digit PIN, then fill in name, grade, department and, if absent, a reason. Date and time are recorded by the server.
- **Admin** (button in the banner, password protected): rename the program and edit its dates, venue and PIN. You can also turn the PIN step and the department question on or off, show or download the QR code, close or reopen the form, see the live attendance analysis (refreshed every 5 s), delete records, copy to Excel, download a CSV or print a PDF report, and create, switch or delete programs.
- The attendance analysis is shown only in Admin mode.

## Customise

Edit `config.js` to set the grade and department lists, which are still the design's placeholders, the organisation name and the program created on first start.
