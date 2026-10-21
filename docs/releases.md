# FundWork v1.0.4

- Added **Special Submissions** under COA Submissions, separate from the regular reporting checklist.
- Added the CY 2026 Interim Audit request from Division Memorandum 420, s. 2026: 66 requirements plus Annex A, office filters, countdowns, and access to the original PDF.
- Track Annex A against October 23, 2026 and other documents against the internal November 6 deadline. The request also shows COA's November 13 deadline.
- Special submissions use the existing upload pre-checks, approval, revision, history, and release controls. COA personnel can access approved files only.
- One-time requirements remain outstanding across tracking-year changes without creating another annual request.
- Fixed filters carrying between the regular and special checklists, and overview links failing to show the selected report when filters were active.
- Fixed special-report ordering and empty-table column alignment. The original request can also be opened during a read-only role preview.

## Database setup

Existing installations need `20261022000000_special_submissions.sql` after the earlier migrations. It adds the shared request catalog and fixed deadlines. It can be rerun after manual application without duplicating requirements or overwriting existing records.

## Validation

Accounting, SQLite, COA schedule, pre-check, workflow, and special-submission tests pass, together with JavaScript syntax checks. Headless Edge checks cover checklist separation, office filters, details, and navigation with active filters.
