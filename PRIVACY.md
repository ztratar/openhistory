# OpenHistory Privacy Policy

Last updated: August 15, 2026

OpenHistory is a local-first macOS application. This policy describes the data handled by the open-source app and the choices available to you. A distributor may publish additional terms for downloads or update infrastructure, but those terms must not weaken the in-app controls described here.

## Activity OpenHistory can collect

After you accept the first-run notice, OpenHistory can observe foreground applications and permitted macOS Accessibility context. Depending on your Settings choices, that context can include application and window names, focused controls, text changes, clicks, browser URLs or domains, document context, and visible interface text. OpenHistory does not capture screenshots, camera input, microphone input, audio, or low-level keyboard events.

Secure and password-labeled fields, private browser windows, recognized adult websites, and recognized password and messaging applications are always excluded. Email activity is excluded by default and can be enabled in Settings. When enabled, recognized mail apps and webmail may contribute local activity, email addresses are no longer automatically redacted from captured context, and selected evidence may be sent to the configured cloud inference provider. OpenHistory checks adult-site domains locally and does not record the matched domain or category. These protections reduce risk but cannot guarantee that every custom field, adult domain, or sensitive value is recognized. Treat your local OpenHistory directory as private.

## Where data is stored

Raw activity, timeline entries, hour and day summaries, settings, encrypted API keys, and local-agent credentials are stored in a permission-restricted OpenHistory data directory on your Mac. When browser URL capture is enabled, a sanitized HTTPS destination selected as important may also be stored with a new hour or day summary so its matching label can be opened as a link. OpenHistory does not operate an analytics or telemetry service and does not receive this local data.

You can pause capture from the app header, disable individual capture categories, exclude applications, inspect the local data folder, or delete all local OpenHistory data from Settings.

## On-device and cloud inference

Apple On-Device inference is experimental and runs through the system language model on a compatible Mac. Evidence does not leave the Mac through this path.

OpenAI, Anthropic, and Kimi are optional cloud providers. Before OpenHistory enables a cloud provider, it shows a separate confirmation describing the evidence that can be transmitted. When enabled, OpenHistory sends selected evidence from completed work sessions directly to that provider to create summaries. When you use Chat, OpenHistory also sends the conversation, relevant sanitized history, and, when needed, privacy-filtered activity from a requested recent time window, whether or not that activity has already been included in a timeline summary. The provider handles that evidence under its own terms and privacy policy. OpenAI requests set `store: false`; OpenHistory does not control provider-side processing beyond the available API settings.

First-run setup requires choosing a summary model after accepting local activity collection. The Apple option is labeled as experimental, lower quality, and maximum privacy. Cloud options are labeled as higher quality and external processing, require a provider key, and repeat the transmission disclosure before setup can finish. Apple setup cannot finish when the system model is unavailable; the app explains the on-device requirement and asks the user to upgrade or choose a cloud provider. It never silently falls back to cloud.

Saving an API key alone does not authorize cloud inference. Keys saved in the app are encrypted using macOS-backed Electron secure storage and are never returned to the renderer.

## Local agent access

The optional MCP service binds only to `127.0.0.1`, requires a separately revocable bearer credential, and exposes a redacted projection rather than raw activity. Credentials are stored as hashes. A local process acting with your macOS account may still be able to access files available to that account.

## Diagnostics

The Settings action **Export safe diagnostics** creates a JSON file containing app and operating-system versions, status, settings, boolean error indicators, and item counts. It excludes activity content, exact local paths, error messages, application-exclusion names, API keys, and agent credentials. You decide where to save and whether to share that file.

## Deletion and uninstalling

The Settings action **Delete all local data** permanently removes the app's owned activity-data directory, including raw activity, generated summaries, settings, saved API keys, and agent connections, then restarts the app. It requires a native confirmation. The deletion implementation refuses directories without an OpenHistory ownership marker and cannot target repository fixtures, evaluation corpora, or folders outside the dedicated `activity-data` root.

To uninstall completely:

1. Use **Delete all local data** in Settings.
2. Quit OpenHistory and move the application to Trash.
3. In System Settings, remove OpenHistory from Privacy & Security > Accessibility if it remains listed.
4. Remove any installer or update cache documented by the distributor you used.

If the app cannot start, you can inspect the data location documented in [README.md](README.md) and remove only the dedicated OpenHistory `activity-data` directory. Back it up first if you may need the history later.

## Development and evaluation data

Repository fixtures and private model-evaluation corpora are development assets, not app user data. The in-app deletion path cannot reach them. Destructive tests create isolated synthetic `activity-data` directories under the operating system's temporary directory and verify that sibling and symlinked evaluation files remain intact. Never point deletion tests at a live or private evaluation directory.

## Changes and questions

Material changes to collection, transmission, or deletion behavior should update this policy in the same release. Security issues should follow [SECURITY.md](SECURITY.md); other questions can use the repository issue tracker.
