# Special submissions

The COA sidebar has a separate Special Submissions checklist. Its initial request is Division Memorandum 420, s. 2026, for the CY 2026 interim audit. The bundled reference is `assets/coa-interim-audit-2026.pdf` and opens through the operating system's PDF viewer.

`coa/special.js` contains 66 numbered requirements and Annex A, transcribed from the supplied scan. Item 66 collects the financial statements for the Regular Fund, Provident Fund and consolidated DO plus two IUs. Requirements collect supporting files from SDO and the two IUs; item 66 uses SDO and Conso. An authorized uploader can mark an inapplicable requirement with a reason. These office slots support Accounting's consolidation, rather than assigning individual departments automatically.

Internal deadlines are October 23, 2026 for Annex A and November 6, 2026 for the other requirements. The attached COA letter gives November 13, 2026 as its deadline. The supplied 15-page scan starts Annex A at section 4.3; the UI flags the need to request the complete form.

Special reports use their own report codes, a single allowed year, a request issue date and a fixed due date. They remain outstanding after a tracking-year change and do not generate another annual request. They use the existing private storage, pre-checks, review, release, history and role permissions. COA personnel see approved submissions only. Regular checklist filters exclude special submissions, and reminders include both with separate navigation badges.

Apply `supabase/migrations/20261022000000_special_submissions.sql` to enable the shared catalog. It adds request metadata and fixed-date support without modifying existing submission records or access policies. The desktop Supabase setup page lists this migration, or use `npm run supabase -- migrate` with a valid management token. The user reported applying the SQL manually in the Supabase editor. The local management token returned HTTP 401, so remote state has not been independently verified. This migration can be rerun safely to record a manual application in the migration ledger.

Validation: `npm test`, `npm run check`, and a headless Edge preview of the special checklist, office filtering, Annex A details and exclusion from the regular checklist. The special workflow tests cover fixed deadlines, request visibility, persistence across tracking years, rejected periods, reviewer permissions and COA visibility before and after approval.
