# FundWork v1.0.3

- Books now live in a local SQLite database (`fundwork.db`) instead of `accounts.json`. Each save is written in one step, so an interrupted save can't leave half-written records.
- Existing records move over automatically on first launch. The old file is kept as `accounts.json.migrated`.
- Backups are still `.json` files, and older backups still restore. Before a restore, FundWork now saves a full copy of the database as `fundwork.db.before-restore`.
- The checklist's office filter is now a dropdown alongside the other filters.
- Office, Period, Due, Countdown, Status and Files are centered in report tables.
- The Division Office is now named **Isabela City SDO**.
- **Allow user** for the Division Accountant now asks only for email, workplace and position. People type their own name when they register, and editing a user keeps their registered name.
