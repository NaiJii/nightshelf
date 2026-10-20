# NightShelf

Android reader with on-device downloads, offline reading and library management.

## Build an Android APK on GitHub

Open **Actions → Android APK → Run workflow** and choose `arm64` (default) or
`armv7` for phones running 32-bit Android, including affected Galaxy A13 models.
This runs on a standard
Ubuntu runner; it does not use Expo's cloud build allowance. Builds are manual,
limited to 35 minutes, and never triggered by pull requests or pushes.

Keep the account's **Actions budget at $0 with usage blocked at the limit** to
prevent paid overages. Included GitHub Actions minutes and storage still apply.
The APK is available in the run's `NightShelf-arm64` or `NightShelf-armv7` artifact
for one day.

The repository secret `ANDROID_SIGNING_CREDENTIALS` holds the existing release
keystore as base64 plus `keystorePassword`, `keyAlias` and `keyPassword`. Never
commit these values. The workflow checks the APK's signing certificate against
the existing NightShelf certificate and checks that native libraries match the
selected architecture. Both variants use the same app ID, version and signing key.

Run `npm test`, `npm run typecheck` and `npm run lint` to check changes.
