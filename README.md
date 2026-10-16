# Fundwork desktop accounting

Local Electron app for separate Regular, Trust and Provident funds.

## Run

Install Node.js, run `npm install`, then `npm run dev` in this folder. `npm start` also launches the app. No hosted service is used. Records are stored in Electron's user-data folder, not the source folder. Use Settings to save and restore JSON backups.

## Workflow

1. Set organization and reporting year, then choose a fund.
2. Import opening balances separately (a complete balanced set).
3. Import CSV/XLSX journal exports, select the sheet and header row, map columns, validate, review, and post.
4. Review journals, general ledger, and pre-closing trial balance.
5. Map account types and identify cash equivalents. Classify net cash movements by journal reference.
6. Export working reports to Excel. All financial statements are drafts requiring accountant review.

Journal references must be unique within each fund/year, and each reference must balance. A repeated reference is rejected. Multi-purpose cash journals must be split in the source for correct cash flow classification. Import dates must be ISO or MM/DD/YYYY; amounts use at most two decimals. Opening balances should include balance sheet accounts only.

## Current scope

Implemented: persisted local books, imports with mapping and validation, fund isolation, account ledger, trial balance, account classifications, draft performance/position reports, cash movement classification, Excel working-paper export, and backups.

Pending: exact population of supplied year-end templates, complete cash flow statement presentation, comparative statements, statement of changes in equity, adjusting/closing workflows, transaction editing/reversal, audit history, and a signed Windows installer. This is an initial desktop foundation, not a completed statutory reporting system. Do not import closing entries before reviewing performance reports: the current draft performance report uses all posted current-year revenue/expense balances.

Source templates remain at `C:\Users\DepEd\Desktop\Accounting` and are not modified.

Run `npm test` for core accounting validation checks.

