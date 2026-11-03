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

- **Participants** scan the program's QR code, which opens `/?p=<id>`. The bare `/` opens the *current* program. They choose Present or Absent and enter the 4-digit PIN. Then they type part of their name and pick it from the staff list, and their grade and location fill in automatically. People who aren't on the list tap **Not on the list?** and type their name, grade and location or agency. Absent staff add a reason. The server records the date and time.
- **Admin** (button in the banner, password protected): rename the program and edit its dates, venue and PIN. You can also turn the PIN step and the location question on or off, upload the staff list, show or download the QR code, close or reopen the form, see the live attendance analysis (refreshed every 5 s), delete records, copy to Excel, download a CSV or print a PDF report, and create, switch or delete programs.
- The attendance analysis is shown only in Admin mode. Once a staff list is uploaded, it also counts and lists **staff not yet recorded** for the program, and those staff appear in the CSV, Copy to Excel and PDF report as well.

## Staff list (PERJAWATAN)

In Admin, use **Staff list → Upload PERJAWATAN (.xlsx)**. The app reads the sheet whose header row has `BIL`, `GRED`, `PENYANDANG JAWATAN` and `LOKASI`, skips vacant posts (`Kosong`), and stores the list in the database. It is never committed to git. Uploading a newer month's file replaces the list, and records already linked to staff who are still on it stay linked.

The staff list is only sent to a phone after the correct program PIN is entered (or to a logged-in admin). If a program's PIN is turned off, anyone with the link can see the names.

## Customise

Edit `config.js` for the LOKASI code names (`HQ` Ibu Pejabat, `K` Kuching, `M` Miri, `B` Bintulu, `JKR` JKR Sarawak; codes without a name, such as `H`, are shown as-is), the location choices and grade suggestions offered to guests, the organisation name and the program created on first start.
