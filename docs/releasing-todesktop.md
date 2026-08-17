# ToDesktop release spike

OpenHistory uses ToDesktop Platform only as an experimental macOS packaging and update path. The integration is linked to the public ToDesktop application ID `260815ukaa3eq`, but it does not contain an access token, signing certificate, or automatic release workflow.

## What the spike proves locally

- The Electron application and universal native helper compile locally into a valid uploadable application root, and the remote hooks verify and embed those prebuilt outputs without requiring development or Swift toolchains on ToDesktop's worker.
- The ToDesktop CLI can produce its exact source archive without authentication or upload.
- The archive is controlled by an explicit allowlist. It excludes `.env.local`, activity data, private evaluation corpora, reports, tests, Finder metadata, and unrelated repository content.
- `activity-collector` and `foundation-model-worker` compile in release mode for ARM64 and x86_64 and can be combined as universal binaries.
- The native executables are packaged in `OpenHistory Collector.app` with the stable `io.github.ztratar.openhistory.collector` identity.
- The `afterPack` hook embeds the helper under the main application's resources before ToDesktop applies Electron fuses, Developer ID signing, notarization, and installer creation.
- The application resolves both the development helper paths and the packaged nested helper paths.
- A universal Node-API Accessibility identity probe can execute inside the Electron main process, allowing macOS to authorize the permanent `io.github.ztratar.openhistory` identity instead of the nested collector identity.

The only material question that requires a real ToDesktop build is whether its current macOS worker image supplies the Xcode 26 SDK used by the Foundation Models helper. The production build will fail closed if the Swift build or native embedding fails.

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

Build and validate an optimized native helper and exercise the actual `afterPack` hook against a synthetic temporary application bundle:

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

The archive should contain only compiled Electron output, the prebuilt universal native helper, lifecycle hooks, package metadata, the app icon, and the public license. Electron and Swift source plus development-only build configuration are not uploaded. The helper receives a local ad-hoc baseline signature so ToDesktop can safely traverse its nested code objects; ToDesktop then replaces those signatures with the final Developer ID identity and notarizes the complete app.

## Native package layout

The `afterPack` hook creates this layout before production signing:

```text
OpenHistory.app/
  Contents/
    Resources/
      native/
        accessibility-identity-probe.node
        OpenHistory Collector.app/
          Contents/
            Info.plist
            MacOS/
              activity-collector
              foundation-model-worker
```

The nested bundle and probe carry local ad-hoc baseline signatures when inserted. A remote ToDesktop build must replace them with final Developer ID signatures across the complete nested code hierarchy.

## Accessibility identity result

The in-process Accessibility architecture is viable. The spike loads a universal Node-API module in Electron's main process and records only process identity and permission state when `OPENHISTORY_ACCESSIBILITY_IDENTITY_SPIKE=1` is explicitly set. It disables the executable collector during that run so the two identities cannot be confused.

The packaged macOS test established all of the following:

- JavaScript and native code reported the same process identifier.
- `CFBundleGetMainBundle()` reported `io.github.ztratar.openhistory`.
- `AXIsProcessTrusted()` returned true for that process.
- A content-free `AXUIElementCopyAttributeValue` call could read the focused application.
- The app and probe were successfully signed with `Developer ID Application: Zachary Tratar (PNTEN2B9C4)`, shared Team ID `PNTEN2B9C4`, and passed strict deep code-sign verification.
- System Settings displayed one enabled `OpenHistory` Accessibility entry and no `OpenHistory Collector` entry.

This proves that moving the collector engine into a native module loaded by Electron can provide the intended single-permission experience. It does not yet prove the full collector refactor, the first-run prompt on a clean TCC database, ToDesktop notarization of the new module, or authorization persistence across a signed auto-update. Those remain release gates for the implementation.

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

It requires the permanent main and nested bundle identifiers, Developer ID Application signatures, secure timestamps, hardened runtime, matching Team IDs, strict code-sign verification, Gatekeeper acceptance, and a stapled notarization ticket. Preserve its output with the build ID and source commit.

Then verify behavior on a clean test account or separate Mac, using the artifact as downloaded so the quarantine attribute is present:

1. Gatekeeper and notarization acceptance.
2. Drag-to-Applications install, first launch, normal quit, and relaunch.
3. Accessibility permission grant and persistence after restart.
4. Apple on-device availability on a compatible macOS 26 Mac.
5. Cloud-key storage and a generated timeline/hour/day sequence.
6. Sleep/wake, lock/unlock, and login-item behavior.
7. Collector replacement without a duplicate or orphaned process.
8. Complete uninstall/reinstall without unexpected loss of user-owned local data.

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
- `scripts/todesktop-after-pack.cjs` — release Swift build and nested helper embedding.
- `native/collector/scripts/package-release-app.sh` — ARM64, x86_64, and universal helper packaging.
- `scripts/verify-todesktop-spike.ts` — static distribution and privacy invariants.
- `scripts/verify-signed-macos-app.sh` — Developer ID, hardened-runtime, Gatekeeper, Team ID, and notarization-ticket gate for downloaded artifacts.
- `scripts/test-todesktop-after-pack.ts` — synthetic integration test for the actual packaging hook.
