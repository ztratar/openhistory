# ToDesktop release process

OpenHistory uses ToDesktop Platform for macOS packaging and updates. The integration is linked to ToDesktop application ID `260815ukaa3eq`, but the repository does not contain an access token or signing certificate.

## What the release architecture proves locally

- The Electron application and universal native components compile locally into a valid uploadable application root, and the remote hooks verify and embed those prebuilt outputs without requiring development or Swift toolchains on ToDesktop's worker.
- The ToDesktop CLI can produce its exact source archive without authentication or upload.
- The archive is controlled by an explicit allowlist. It excludes `.env.local`, activity data, private evaluation corpora, reports, tests, Finder metadata, and unrelated repository content.
- The Swift collector library, Node-API bridge, and Foundation Models worker compile in release mode for ARM64 and x86_64 and can be combined as universal binaries.
- The Node-API bridge loads the complete Swift collector inside Electron's main process. Accessibility therefore belongs to the permanent `io.github.ztratar.openhistory` application identity.
- The `afterPack` hook embeds the native module, its Swift dynamic library, and the standalone Foundation Models worker under the main application's resources before ToDesktop applies Electron fuses, Developer ID signing, notarization, and installer creation.
- The packaged application resolves the native collector module and Foundation Models worker from that resource directory.

A real ToDesktop build is still required to prove Developer ID replacement signing, notarization, installer generation, and updates with this native layout. The production build fails closed if native embedding or final signature validation fails.

## Local verification

Install application dependencies and the isolated release toolchain:

```bash
npm ci
npm run desktop:tools
```

Run all application tests plus the distribution-contract checks:

```bash
npm run check
```

Build and validate the optimized native components and exercise the actual `afterPack` hook against a synthetic temporary application bundle:

```bash
npm run desktop:verify
```

Generate the exact ToDesktop source archive and list every included file without authenticating, uploading, or creating a remote build:

```bash
npm run desktop:dry-run
```

Build a complete runnable application on the current Mac without credentials, an upload, or Developer ID signing:

```bash
npm run desktop:package:local
```

The command prints the architecture-specific `.app` path when it succeeds. Open that application from Finder or with `open` to perform the UI smoke test.

The local packager starts from a strict runtime allowlist, prunes development dependencies, stores the application in ASAR, applies the same security fuses as the ToDesktop configuration, exercises the real `afterPack` native-embedding hook, ad-hoc signs the complete code hierarchy, and verifies the result. The artifact is suitable for local onboarding, permission, collection, inference, persistence, and restart testing. Ad-hoc signing does not test Gatekeeper distribution, Developer ID identity, notarization, installers, or hosted updates.

The archive should contain only compiled Electron output, the prebuilt universal native components, lifecycle hooks, package metadata, the app icon, and the public license. Electron and Swift source plus development-only build configuration are not uploaded. Native Mach-O files receive local ad-hoc baseline signatures; ToDesktop must replace those signatures with the final Developer ID identity and notarize the complete app.

## Native package layout

The `afterPack` hook creates this layout before production signing:

```text
OpenHistory.app/
  Contents/
    Resources/
      native/
        openhistory-native.node
        libOpenHistoryCollector.dylib
        foundation-model-worker
```

All three components carry local ad-hoc baseline signatures when inserted. A remote ToDesktop build must replace them with final Developer ID signatures using the same Team ID as the main application.

## Accessibility identity result

The in-process Accessibility architecture is implemented. A universal Node-API module loads the complete Swift collector in Electron's main process; there is no separately launched collector executable in the packaged application.

The packaged macOS test established all of the following:

- JavaScript and native code reported the same process identifier.
- `CFBundleGetMainBundle()` reported `io.github.ztratar.openhistory`.
- `AXIsProcessTrusted()` returned true for that process.
- A content-free `AXUIElementCopyAttributeValue` call could read the focused application.
- The app and native module were successfully signed with `Developer ID Application: Zachary Tratar (PNTEN2B9C4)`, shared Team ID `PNTEN2B9C4`, and passed strict deep code-sign verification.
- System Settings displayed one enabled `OpenHistory` Accessibility entry and no `OpenHistory Collector` entry.
- After resetting the application's TCC record, **Grant access** created one disabled `OpenHistory` row; enabling it was detected without relaunching and restarted the embedded collector with Accessibility and pointer capture available.
- Pausing and resuming collection retained the single-process layout and produced live window, URL, pointer, focused-element, UI-snapshot, and text-input events.

The remaining release gates are ToDesktop Developer ID signing/notarization of every native component and authorization persistence across a signed auto-update.

## Credentialed build

The dedicated ToDesktop Platform application is named `OpenHistory` and has ID `260815ukaa3eq`. Do not reuse an unrelated application identity. Configure its dashboard to build macOS artifacts only and use the permanent main bundle identifier `io.github.ztratar.openhistory`. Enable Apple Silicon and Intel packages—or a universal package—plus DMG and ZIP artifacts for the first private build.

Upload the `Developer ID Application: Zachary Tratar (PNTEN2B9C4)` certificate under the application's Certificates settings. ToDesktop requires the exported password-protected `.p12`, its password, Team ID `PNTEN2B9C4`, and an Apple app-specific password to sign and notarize DMG, ZIP, and universal-installer targets. A `Developer ID Installer` certificate is additionally required only if PKG output is enabled. Keep programmatic releases disabled for the first release so a private build cannot be published with only an access token.

Create a short-lived ToDesktop access token scoped to the OpenHistory application. Record the candidate commit and require a clean worktree before the credentialed build:

```bash
git status --short
git rev-parse HEAD
npm ci
npm run desktop:tools
npm run check
npm run desktop:verify
npm run desktop:dry-run
```

Review the dry-run file list and archive SHA-256 in the release record. The list must not contain `.env` files, local activity, reports, fixtures, tests, or unrelated worktrees.

Provide credentials only through the environment:

```bash
export TODESKTOP_EMAIL="your-account-email"
export TODESKTOP_ACCESS_TOKEN="your-access-token"
npm run desktop:build
```

`desktop:build` uses ToDesktop's ephemeral credential mode. It creates a remote build and follows the macOS build logs, but it does not release anything to users.

After downloading and extracting the private artifact, run the automated macOS distribution gate:

```bash
npm run desktop:verify:signed -- "/path/to/OpenHistory.app"
```

It requires the permanent main bundle identifier, Developer ID Application signatures on the app and every native component, secure timestamps, hardened runtime, matching Team IDs, strict code-sign verification, Gatekeeper acceptance, and a stapled notarization ticket. Preserve its output with the build ID and source commit.

Then verify behavior on a clean test account or separate Mac, using the artifact as downloaded so the quarantine attribute is present:

1. Gatekeeper and notarization acceptance.
2. Drag-to-Applications install, first launch, normal quit, and relaunch.
3. Accessibility permission grant and persistence after restart.
4. Apple on-device availability on a compatible macOS 26 Mac.
5. Cloud-key storage and a generated timeline/hour/day sequence.
6. Sleep/wake, lock/unlock, and login-item behavior.
7. Collector startup, pause/resume, and settings changes without a duplicate process or second Accessibility entry.
8. Rapid typing in a multiline editor and a sent Messages/iMessage compose test; confirm the complete burst is captured once rather than as partial or duplicate events.
9. Complete uninstall/reinstall without unexpected loss of user-owned local data.

Run ToDesktop's launch and update smoke test when the selected plan supports it:

```bash
npm run desktop:smoke-test
```

For the first public update, separately exercise `0.1.0` to `0.1.1` on a controlled test machine and confirm local activity, settings, Accessibility authorization, stored cloud credentials, and the collector process survive the update. Do not treat a successful notarization as evidence that application behavior or updates work.

Only after those checks pass should a selected build be released:

```bash
npm run desktop:release
```

The release command intentionally retains ToDesktop's confirmation step. For the first release, prefer the dashboard's Prepare Release checks and keep programmatic releases disabled. Verify the exact build ID and version before confirming; `--latest` is safe only while no newer build exists.

## Dependency isolation

`@todesktop/runtime` is a pinned production dependency. The pinned ToDesktop CLI lives under `tools/todesktop` because its React 17 terminal UI is incompatible with the application's React 19 dependency tree when npm hoists them together. The application root currently audits with zero known vulnerabilities.

The isolated CLI has four moderate transitive advisories in its legacy version-checking path. Its vulnerable `fast-uri` pin is overridden to patched version `3.1.5`, removing the high-severity findings. Keep the release CLI isolated, use it only with trusted ToDesktop endpoints, and review its audit before every public release.

## Files that preserve the contract

- `todesktop.ts` — app identity, explicit upload manifest, fuses, resources, and macOS settings.
- `scripts/todesktop-before-build.cjs` — remote Electron compilation and macOS-only enforcement.
- `scripts/todesktop-after-pack.cjs` — native component embedding.
- `native/bridge/build.sh` — ARM64, x86_64, and universal in-process collector bridge builds.
- `native/collector/scripts/package-release-app.sh` — Foundation Models worker staging.
- `scripts/verify-todesktop-spike.ts` — static distribution and privacy invariants.
- `scripts/verify-signed-macos-app.sh` — Developer ID, hardened-runtime, Gatekeeper, Team ID, and notarization-ticket gate for downloaded artifacts.
- `scripts/test-todesktop-after-pack.ts` — synthetic integration test for the actual packaging hook.
