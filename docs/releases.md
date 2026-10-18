# FundWork v1.0.1

FundWork helps school and division office staff keep fund records, track report deadlines, and submit reports for COA review.

## Changes in this release

- Report uploads cover January 2026 through the current reporting month. Future months become available automatically.
- Separate checklists, uploads, and review status for Regular, Provident, and Trust funds. Filter the checklist by fund.
- A separate URS-generated FAR No. 4 requirement alongside FAR No. 4 (Monthly Report of Disbursements).
- Trial balance checks apply to all three funds. Approving one fund does not approve another.
- Fixed release publishing so installer builds can read these release notes.

## What you can do

- Keep separate records for Regular, Trust, and Provident funds.
- Import opening balances and journal entries from Excel or CSV files.
- Check entries for errors before saving them, including unbalanced entries and repeated journal references.
- View journals, account ledgers, trial balances, and draft financial reports.
- Classify accounts and cash movements, then export Excel working papers for review.
- Save and restore backups of the accounting records on your computer.
- See which reports are due, overdue, waiting for review, returned for correction, or released to COA.
- Upload report files, correct returned submissions, and download available attachments.

## User roles

| User | What they can do |
| --- | --- |
| Division Accountant | Monitor reports across offices, upload reports, review submissions, return reports for correction, and approve reports for release to COA. Manage access for school and office users and help reset their passwords. |
| SDO Senior Bookkeeper | Upload and submit reports for the division office and consolidated reports. Track deadlines and correct submissions returned by the Division Accountant. |
| Basilan NHS Senior Bookkeeper | Upload and submit reports for Basilan NHS, track the school's deadlines, and correct returned submissions. |
| Begang NHS Senior Bookkeeper | Upload and submit reports for Begang NHS, track the school's deadlines, and correct returned submissions. |
| COA personnel | View report progress and download reports released to COA. They cannot upload reports or approve submissions. |

## Getting started

1. Ask the Division Accountant to allow your email address, then choose **Register** and create your password.
2. Sign in with your email and password. The screens and reports available to you depend on your assigned role and office.
3. For accounting work, choose the fund and year. Import opening balances first, then import journal entries. Review the checks before saving the entries.
4. For report submission, open the **Checklist**, choose your office and reporting period, and select the report you need to submit.
5. Attach the report files and check any messages about possible problems. Fix any blocking issues before submitting for review.
6. The Division Accountant reviews the submission and either releases it to COA or returns it with a note explaining what needs correction.
7. If a report is returned, upload the corrected file and submit it again.

## Report tracking

- The overview shows report progress and approaching deadlines.
- The checklist covers monthly, quarterly, semi-annual, and annual reports. You can filter by fund, office, period, and status, or search for a report.
- Due dates and countdowns use Philippine dates.
- File checks help spot possible problems, such as a different office or reporting period. These checks still need human review.
- You can attach PDF, Excel, CSV, Word documents, and JPG or PNG images, up to 50 MB per file.
- Submission history records uploads and review decisions.
- Desktop reminders help you keep track of deadlines while FundWork is running.

## Your records and account

Accounting records stay on the computer where you entered them. Save backups regularly, especially before changing computers. Shared accounts and submitted COA reports need an internet connection. You will need to sign in again after restarting the app.

If you forget your password, ask the Division Accountant for help. After receiving a temporary password, you will be asked to choose a new one.

## Downloads

Choose the file that matches your computer from the downloads below:

| Computer | Download |
| --- | --- |
| Windows 64-bit | FundWork-1.0.0-win-x64.exe |
| Mac with an Apple M-series chip | FundWork-1.0.0-mac-arm64.dmg |
| Mac with an Intel processor | FundWork-1.0.0-mac-x64.dmg |

Open the downloaded installer to install FundWork. Your computer may display a security warning because the installers do not yet have a verified publisher signature.

## A few technical details

- FundWork is an Electron desktop app for Windows 64-bit, Apple Silicon Macs, and Intel Macs.
- Accounting books are stored in the app's local data folder. Settings lets you export and restore JSON backups; Excel exports provide working papers for review.
- Shared sign-in and COA report submissions use Supabase, an online service. Access permissions limit what each role can view or change.
- Journal imports support CSV and XLSX files, with worksheet selection and column mapping. Each journal reference must balance and be unique within its fund and year.
- Import dates must use YYYY-MM-DD or MM/DD/YYYY, and amounts support up to two decimal places.
- Report pre-checks run locally before submission. Some checks can read spreadsheet contents; other file types still need manual review.

## Current limitations

Financial reports are drafts and need an accountant's review. Complete year-end forms, comparative reports, the full cash flow statement, the statement of changes in equity, closing procedures, corrections to saved transactions, and complete accounting change history are still being developed.

Review income and expense reports before importing closing entries, because closing entries can affect the figures shown in the draft reports.
