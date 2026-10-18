# Shared FundWork accounts

The Electron app uses `coa/supabase-source.js` and the configured Supabase project.
Allowed emails are stored in `public.members`. `user_id` stays null until
registration, which is displayed as **Waiting to register**. Supabase Auth
stores credentials and links the account through the existing registration
trigger. The role is assigned by the manager, never by the registrant.

Restart FundWork after updating from the local account version. Sign in using
the shared account's email and password. The hidden superadmin screen also uses
the shared email and password; the old computer-only superadmin password does
not authenticate a Supabase account. Sessions are held in memory, so restarting
requires signing in again. Accounts remain in the database.

The desktop bridge sends requests only to the configured project. The app uses
the publishable key and each person's access token. Management tokens and
service keys from `.env.supabase` are not used by the app or packaged with it.
Database functions and RLS enforce account and report permissions.

Existing local account files are not automatically uploaded. The Division
Accountant email shown during this change was added to the shared allowlist
without creating an Auth account or assigning a password.

Validation:

- `npm run check`
- `npm test`
- `node scripts/test-shared-accounts.js` (explicit live integration test)

The integration test uses the development Management API token to set up and
remove temporary test accounts. It checks separate sessions, registration,
profile loading, access restrictions, and deactivation. It does not send email
under the project's existing no-email signup configuration.
