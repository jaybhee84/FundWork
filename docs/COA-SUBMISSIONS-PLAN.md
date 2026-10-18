# COA Submissions module for FundWork

Status (Oct 18, 2026): build-order steps 1–3 done on the in-memory demo source. Steps 4–7 still to be built.

- `coa/schedule.js`: schedule engine (unchanged).
- `coa/precheck.js`: rule-based pre-checks (section 6).
- `coa/demo-source.js`: in-memory data source and workflow rules. `INTERFACE` lists the async methods the Supabase source must implement. It adds `resubmit` (send a returned item's remaining files back for review after removing a wrong file), so step 4 also needs a `resubmit_submission` RPC.
- `coa/ui.js` + `coa/coa.css`: Overview, Checklist, details panel, demo "Viewing as" switcher.
- `main.js`: `coa-read-sheets` (ExcelJS reads uploads for pre-checks), daily notification, tray, start with Windows (installed app only). Prefs in `userData/coa-desktop.json`.
- Tests: `node coa/test.js` runs the schedule, pre-check and workflow checks.
- **Accounts (current, Oct 18, 2026): allowed users, no email.** The Division Accountant (or the superadmin, for a Division Accountant) allows an email on **Allow users**: Family / First / Middle name (optional), where the person works (School IU + school, SDO, COA) and position, which set the role and offices. Only allowed emails can register (email + password); Supabase rejects other sign-ups (`on_auth_user_created` trigger). No emails are sent ("Confirm email" off in Supabase Auth). Forgot password = temporary password from Reset password, changed at the next sign-in. IU/SDO staff need @deped.gov.ph; COA may use any email. Names display as "Family, First Middle", every word capitalised (JS `capitalizeName` = Postgres `initcap`). Migration `20261018010000_no_email_accounts.sql` implements this and replaces the earlier registration-request flow described below.
- Earlier sign-in design (superseded): `coa/login.js`, added Oct 18, 2026 at the user's request: **email + password** (not email OTP). Registration asks for a base, **School (IU = Implementing Unit)**, **SDO** or **COA**, plus position and password, confirms the email with a 6-digit code, and then waits for approval. Forgot password uses an emailed code. Each person changes their password in **Account settings** (click your name in the sidebar).
- Roles shown as: Division Accountant (`accountant`), Senior Bookkeeper (`uploader`; an IU bookkeeper covers their school), COA personnel (`coa`, COA pages only). Demo accounts are role-based (no personal names): Division Accountant, BNHS Senior Bookkeeper, BeNHS Senior Bookkeeper, COA Auditor. Password `demo1234`.
- **Access** page (Division Accountant and superadmin): approve or decline registrations, add or edit members, turn access off. Only the superadmin can approve or change a Division Accountant, and at least one must stay active.
- **Superadmin**: click the sign-in logo 5 times. The default password `123456` must be changed on first use. It is stored as a scrypt hash in `userData/superadmin.json` (delete the file to reset it to the default), and 5 wrong tries lock it for 5 minutes. It manages accounts only: no books, no report reviews.
- **Database SQL**: `supabase/migrations/20261018000000_coa_submissions.sql` covers the tables, RLS, private `coa-files` bucket, RPCs (`register_upload`, `resubmit_submission`, `review_submission`, `set_not_applicable`, `reopen_submission`, `remove_file`, `approve_access`, `decline_access`, `save_member`, `set_member_active`) and the registration trigger on `auth.users`. It was verified in PGlite (Postgres 16) with stand-ins for `auth`/`storage`: due dates and labels match `coa/schedule.js` for every report from 2025 to 2027, and the role and RLS rules were exercised as real users.
- **`npm run supabase -- status | migrate | sql "…" | sql -f file | add-member …`** (`scripts/supabase.js`) runs SQL through the Supabase Management API using a personal access token in `.env.supabase` (git-ignored; template in `.env.supabase.example`).
- **Supabase page** (superadmin): project URL + publishable key (stored in `userData/coa-backend.json`), Test connection (checks the key and whether the database is set up), Copy setup SQL. It refuses secret, service_role and `sbp_` keys.
- Supabase project: `https://xdellysgtpmzxmygkyow.supabase.co` (`coa/supabase.config.json`). Still needs the publishable key and custom SMTP. Supabase's built-in email only reaches project team members. The superadmin must become a server-side admin role then, because a local password cannot authorize server changes.

## 1. What the Division Accountant asked for

Translated from her messages (Chavacano), Oct 18, 2026:

1. **A database for her COA files.** Shirley and Abiebie upload the reports.
2. **Separated by office:** SDO, Basilan NHS, Begang NHS, Conso (consolidated).
3. **She reviews before COA sees anything.** Uploads wait for her approval. Only approved files become downloadable by the COA counterpart (resident auditor).
4. **Deadline reminders connected to her DepEd email.** Starting **10 days before** each due date, remind her **every day with a countdown** until the report is submitted.
5. **Flag what is missing.** She uploads what she has, and the app shows what has not been submitted yet.
6. **AI pre-audit** that catches "weird stuff" in uploaded files before she reviews.
7. **One system.** Generate the financial statements automatically from exported journal entries and catch issues there. FundWork already does part of this. That is why she asked to put the tracker inside FundWork.

References (read-only, do not modify):

- `C:\Users\DepEd\Desktop\Coa Report\Reports-to-be-submitted-to-COA.docx`: the required reports and due dates, now encoded in `coa/schedule.js`.
- `C:\Users\DepEd\Desktop\Coa Report\Other-reports-to-be-prepared-for-COA.docx`: the books, registers and schedules COA inspects (GL, SL, CRJ/CDJ/CkDJ/GJ, RAAOD, RBUD, RCD, cash books, PPELC, aging schedules, audit trackers). Use it for future FundWork outputs, not for the tracker's v1 checklist.
- `C:\Users\DepEd\Desktop\Accounting\*.xlsx`: year-end FS templates (Regular, Provident, Trust), already referenced by FundWork.

## 2. How it fits into FundWork

FundWork today is **local-only**: one PC, records in `%APPDATA%/FundWork/fundwork.db` (SQLite, see `store.js`; formerly `accounts.json`), and "Records stay on this computer" in the sidebar.

The submission workflow is inherently **multi-user**. Two uploaders, one reviewer and an external COA auditor work on different PCs. That is impossible without a shared backend.

**Recommended split:**

- **Books stay local** (journals, GL, TB, FS): no change to the current privacy model.
- **New "COA Submissions" section** in the FundWork sidebar talks to a shared backend. Only the submitted report files and their review status go online.
- Update the sidebar footer text so it stays truthful, e.g. "Books stay on this computer · COA submissions are shared".

**Recommended backend: Supabase** (free tier to start):

| Need | Supabase feature |
|---|---|
| Sign-in with DepEd email | Email OTP: a 6-digit code mailed to the address, so no password and it proves inbox ownership |
| Roles and office restrictions | Postgres + Row Level Security, enforced on the server, not just hidden in the UI |
| File storage | Private Storage bucket with RLS. COA can read a file only after approval |
| Daily countdown email, even when no PC is on | `pg_cron` → Edge Function `daily-reminders` → SMTP (Gmail app password or Brevo) |
| AI pre-audit, API key off staff PCs | Edge Function `ai-preaudit` holding `ANTHROPIC_API_KEY` as a secret |

**Confirm this backend choice with the user before building it**, because it needs a Supabase account and SMTP credentials. Build the local-only pieces first: the checklist UI, rule-based pre-checks, and the notification scheduler. Use a demo/in-memory data source behind the same interface so the UI can be seen before the backend exists.

FundWork has no bundler and its CSP is `script-src 'self'`. Do the Supabase calls in the **main process** (`require('@supabase/supabase-js')`) and expose narrow IPC handlers through `preload.js`. That keeps the renderer free of network code and keeps the CSP strict. Persist the Supabase session in `userData`.

## 3. Roles and workflow

| Role | Who | Can |
|---|---|---|
| `accountant` | Division Accountant | Everything: review, approve, return, mark N/A, reopen, manage members, edit which office each report applies to, settings |
| `uploader` | Shirley, Abiebie | Upload files for their assigned offices (or all). See status and return notes. Cannot approve |
| `coa` | COA counterpart | See and download **approved** items only |

Membership is an allowlist table (`members`: email, name, role, offices[], active). The accountant adds people. A signed-in email that is not on the list sees an "ask the Division Accountant for access" screen.

Status of one report × office × period:

```
missing ──upload──▶ for_review ──approve──▶ approved (released to COA; countdown stops)
                        │  ▲
                 return │  │ re-upload
                        ▼  │
                      returned
missing/any ──accountant──▶ not_applicable (countdown stops)
approved ──accountant reopen (with reason)──▶ for_review (COA loses access)
```

Rules:

- Approving requires at least one current file.
- Returning requires a note.
- Files are never hard-deleted. Removing one marks it superseded, which keeps an audit trail.
- Log every action (upload, remove, approve, return, N/A, reopen, member change) with user, timestamp and details.

## 4. Schedule engine: done

`coa/schedule.js` (plain JS, works in the renderer as `window.CoaSchedule` and in Node via `require('./coa/schedule')`). Key exports:

- `DEFAULT_UNITS`: SDO, BNHS (Basilan NHS), BEGANG (Begang NHS), CONSO (Consolidated)
- `DEFAULT_REPORT_TYPES`: 21 reports from the COA reference, with frequency and due rule
  - Monthly: MTB, RCI, RADA, BRS (20th), FAR4. Due the 10th of the following month unless noted
  - Quarterly: QFS, QTB (+10 days), FAR1, FAR1A, FAR1B, FAR1C, FAR2, FAR5 (+30 days)
  - Semi-annual: UCA (Jul 15 / Jan 15), APAR (Jul 15, 1st semester only)
  - Annual: YFS, YTB, NOTES (Jan 20), FAR3 (Jan 30), RPCPPE, RPCI (Jan 31)
- `buildChecklist({reportTypes, units, submissions, today, trackingStart, horizonDays, reminderDays})`: every expected item (report × office × period) merged with database rows. Items nobody has touched come back as `missing`. Each item has `dueDate`, `daysLeft`, `urgency` (overdue / today / soon / upcoming / done) and `late`.
- `reminderItems(items, 10)`: what goes into today's reminder.
- `countdownLabel`, `STATUS_LABELS`, `formatDate`, `todayManila()` (Philippine date regardless of PC timezone), `describeDueRule`
- `TRIAL_BALANCE_CODES`, `UNIT_ALIASES`: used by pre-checks

Design choice: expected items are **computed, not stored**. Database rows exist only once someone acts on an item, and each stores its `due_date` snapshot. Changing the catalog never leaves stale rows behind.

Defaults to confirm with the accountant: every report applies to all four offices (she can untick per office in Settings), and `trackingStart` is the first day of the month the office starts using the module, so it doesn't flag years of history as missing. Due dates that fall on weekends are shown as-is; nothing is shifted without an official basis.

The original TypeScript source and Vitest suite live in `D:\AProjects\coa-report` (`supabase/functions/_shared/`, `tests/`). The Edge Functions (Deno) can import the same logic.

## 5. Reminders

- **Daily email** from the `daily-reminders` Edge Function at 7:00 AM Manila (`pg_cron` at 23:00 UTC).
  - Recipients: one digest per person. The accountant gets every item; uploaders get items for their offices.
  - Content: items with `daysLeft <= reminder_days` (default 10) that are not approved or N/A, overdue first, each with its countdown ("3 days left", "2 days overdue").
  - Subject line example: "COA reports: 2 overdue, 5 due within 10 days".
  - Keep a `reminder_log` keyed (date, email) so a re-run never double-sends.
- **Desktop**: when FundWork is open (optionally minimized to tray, optional "start with Windows"), show one Windows notification per day with the same countdown summary, and a count badge on the sidebar item.

## 6. Pre-audit

**Rule-based checks**, run at upload time in the app (deterministic, always on):

- **Blocking:** empty file; larger than 50 MB.
- **Warnings:**
  - Unusual file type (allowed: pdf, xlsx/xls/xlsm, csv, docx, jpg/png).
  - The same file (SHA-256) was already uploaded under another report, office or period. Name where.
  - The file name or the sheet header text mentions a **different office** (`UNIT_ALIASES`) or a **different month/year** than the slot it's being uploaded to.
  - **Trial balances** (`TRIAL_BALANCE_CODES`): find the Debit/Credit header row, then sum in **integer centavos**, reusing `Accounting.cents` from `engine.js` where possible. Flag if Debit ≠ Credit, showing the difference, or if a footed "Total" row disagrees with the sum of its rows.
- **Info:** uploaded after the due date (N days late).

Store results as JSON on the file record and show them to the accountant in the review panel.

**AI pre-audit** (optional, server-side Edge Function, enabled only when the key is set):

- Send the PDF as a `document` block, or spreadsheets converted to CSV text, plus the report name and description, office, period and due date.
- Ask for findings: wrong period or office in headers, missing signatures, totals that don't foot, abnormal balances, missing pages or attachments.
- Use the Anthropic TypeScript SDK (`npm:@anthropic-ai/sdk`), `model: "claude-opus-5-5"`, structured output via `output_config.format` (JSON schema: findings[] with severity, title, detail, page/sheet). Use the beta `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta, and check `stop_reason === "refusal"` before reading content.
- Findings are advisory. They never approve or block anything by themselves.
- These are government financial records, so tell the accountant the files go to Anthropic's API when AI pre-audit is on, and let her switch it off.

## 7. Connecting to FundWork's books (Part 2)

- On the Trial balance and Financial statements pages, add **"Submit to COA tracker"**. It exports the same Excel working paper and uploads it into the matching slot (e.g. MTB × office × month), so the pre-check runs on FundWork's own output.
- FundWork funds (Regular / Trust / Provident) map to Fund Clusters 01 / 07 / provident. Keep fund and office separate: one is *which books*, the other is *which office submits*.
- Still missing from FundWork itself (per its README): completed year-end templates, cash flow statement, changes in equity, comparatives, adjusting/closing workflow, audit history. Ask the accountant for a **sample journal export** from her actual accounting system before going further with automatic FS.

## 8. Suggested build order

1. Sidebar entry "COA Submissions" with Overview (overdue / due ≤10 days / for review / returned / released this month, plus a deadlines table) and Checklist (office tabs: All · SDO · Basilan NHS · Begang NHS · Conso; filters by frequency, status and period; table with Report · Office · Period · Due · Countdown · Status · Files; click a row to open a details panel). Runs on the demo data source.
2. Upload flow in the details panel: drop files, run the pre-checks, show the results, then "Submit for review". Then the review actions (approve, return with note, N/A, reopen) and the activity history.
3. Daily desktop notification and tray behaviour.
4. Supabase schema + RLS + storage policies + RPCs (`register_upload`, `review_submission`, `set_not_applicable`, `reopen_submission`, `remove_file`), with the main-process data source behind the same interface as the demo.
5. `daily-reminders` Edge Function + cron; `ai-preaudit` Edge Function.
6. COA view: approved items only, download one file or a whole period.
7. "Submit to COA tracker" from FundWork's TB/FS pages.

Keep FundWork's existing style: plain JS, the same sidebar, the same table and button styles, no new framework. Run `node test.js` and `node coa/test.js` after changes.

## 9. Open questions for the accountant

- Which reports apply to which office? In particular, what does "Conso" submit: only consolidated FS/TB, or everything?
- The COA counterpart's email. If it's not `@deped.gov.ph` that's fine with email OTP, but confirm.
- Should Shirley and Abiebie also get the daily reminder emails, or only her?
- Which month to start tracking from.
- A sample journal export from her accounting system (for Part 2).
