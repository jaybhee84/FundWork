# Build and release FundWork

GitHub Actions runs syntax checks and tests, then builds Windows x64, macOS
Intel x64, and macOS Apple Silicon arm64 installers. Each platform builds on
its native runner, following Project_APE's platform matrix.

Pushes and pull requests to `main` build downloadable workflow artifacts.
You can also start **Build desktop installers** manually from GitHub Actions.
Build output is retained for 14 days.

To publish a release:

1. Update `version` in `package.json` and `package-lock.json` together.
2. Run `npm run check` and `npm test`.
3. Commit and push the changes to `main`.
4. Tag that commit with the package version, such as `v1.0.0`, and push the tag.

The tag must exactly match `v` followed by the package version. Once all three
builds pass, Actions creates the GitHub Release and attaches the `.exe` and
both `.dmg` installers. A failed build prevents publication. Re-running the
workflow for the same tag replaces its installer assets.

Local Windows build: `npm ci`, then `npm run dist:win`.
On a Mac: `npm run dist:mac -- --arm64` or `npm run dist:mac -- --x64`.
Installers are written to `dist/`. These builds are unsigned; macOS builds are
not notarized. Signing requires platform certificates and additional setup.

Only the public Supabase project URL and publishable key ship with the app.
`.env.supabase`, SMTP passwords, management tokens, and service keys must stay
out of Git and installer packages. Live integration tests are run explicitly
from development; Actions does not receive database administration secrets.
