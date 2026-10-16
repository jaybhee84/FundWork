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



## Desktop installers and GitHub Actions

The **Build desktop installers** workflow runs on pushes to `main`, pull requests, and manual dispatch. It uploads Windows x64 `.exe`, Apple Silicon `.dmg`, and Intel `.dmg` as separate Actions artifacts (retained for 14 days).

To publish installers on GitHub Releases, set the version in `package.json` (and update the lockfile with `npm install --package-lock-only`), commit it, then push a matching version tag, such as `v1.0.0`. Tag builds publish only after all three builds succeed. Regular branch builds do not create releases.

Local packaging: `npm run dist:win` on Windows, or `npm run dist:mac -- --arm64` / `--x64` on macOS. Output goes to `dist/`.

These installers are unsigned; macOS builds are not notarized. Windows SmartScreen and macOS Gatekeeper may show security prompts. Trusted distribution requires code-signing certificates and Apple notarization, which are not configured. The GitHub Actions run is the cross-platform build verification; local JavaScript tests do not verify installation on macOS.
