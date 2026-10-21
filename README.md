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


### In-app Android updates

The next signed APK enables automatic update checks against this public repository’s GitHub releases. Existing 2.0.6 installations need that APK installed manually once. Future updates are offered in Home and Settings → App updates; the user approves installation through Android. Automatic checks use unmetered Wi-Fi at most once per day, can be disabled in Settings, and never download APKs automatically. Manual checks/downloads follow the app’s mobile-data preferences.

For each release, increment both `expo.version` and `android.versionCode` in app.json (and the package version), build the desired architecture with the existing free GitHub Actions workflow, and upload the signed artifacts to a published, non-prerelease GitHub release tagged `v<version>`. Preserve the existing signing key and package ID. Use the unchanged filenames `NightShelf-<version>-arm64.apk` and `NightShelf-<version>-armv7.apk`; GitHub supplies the SHA-256 asset digest. Each installation is offered only a newer matching architecture with a published digest. Uploading both variants to the same release is supported. The updater checks the asset size/hash, APK package/version, native ABI and installed signing certificate before launching Android’s installer. No update server, access token, or paid Expo service is required.

Android may ask the user to allow NightShelf to install apps once. Returning after that permission is granted continues to the installer. Cancelling verification/installation keeps the installed version and library intact. A verified APK can be reused if installation is cancelled; the cache is cleared after updating. Native installer and permission behavior must be checked on a physical phone in the next APK build.
