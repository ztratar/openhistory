# OpenHistory

OpenHistory is a private, local-first work timeline for macOS. It observes permitted application activity, turns completed work sessions into structured summaries, rolls closed clock hours into persistent summaries, builds daily rollups, and makes a sanitized projection available to local AI agents over MCP.

The app is under active development. It currently runs from source on macOS 14 or later.

## What it does

- records foreground application and accessibility activity to local, append-only JSONL;
- groups activity deterministically into bounded work episodes;
- builds timeline, closed-hour, and daily summaries automatically about every 12 minutes;
- keeps exact local provenance for every generated timeline entry;
- exposes a read-only, redacted projection through an authenticated loopback MCP server.

OpenHistory does not record screenshots, audio, or low-level key events. It excludes secure and password-labeled fields, private browser windows, recognized adult websites, and recognized messaging and password apps. Email activity is excluded by default and can be enabled in Settings. Enabled email or text-edit capture can contain sensitive text, so treat the local data directory as private.

## Quick start

Requirements:

- macOS 14 or later
- Node.js 22
- Xcode with Swift 6.1 or later
- Apple Intelligence on macOS 26 or later for on-device summaries, or an OpenAI, Anthropic, or Kimi API key (all optional)

```bash
git clone https://github.com/ztratar/openhistory.git
cd openhistory
npm install
cp .env.example .env.local
npm run dev
```

Choose an inference provider and model in the app's **Settings** tab. Apple's experimental on-device provider requires no API key and never sends evidence off the Mac. Cloud providers require their own key. Automatic summaries can also be turned off while local activity collection continues. As an alternative to saving a cloud key, use the ignored `.env.local` file as a fallback:

On first launch, collection remains paused until the privacy notice is accepted. OpenHistory then requires a summary model choice before opening the timeline: Apple On-Device continues without a key, while every cloud choice requires a provider key and an explicit transmission disclosure. Saving a key or setting an environment variable outside onboarding is not consent by itself.

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6-luna

# Or use Anthropic
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-5

# Or use Kimi (Moonshot AI)
MOONSHOT_API_KEY=your_key_here
MOONSHOT_MODEL=kimi-k3
```

Keys saved in Settings are encrypted separately for each provider with macOS-backed Electron secure storage and override that provider's environment fallback. Saved keys are not returned to the renderer or exposed to the native collector or MCP clients.

### Accessibility

Richer context requires macOS Accessibility permission. Open **Settings** in OpenHistory and choose **Grant access**. The development collector has a stable local permission identity at:

```text
native/collector/.build/debug/OpenHistory Collector.app
```

## Architecture

```text
macOS Accessibility APIs
          │
          ▼
Swift collector ──► permission-restricted JSONL
          │
          ▼
Electron main process ──► deterministic episodes
          │                      │
          │                      ▼ automatic update
          │          selected inference provider
          │                      │
          ▼                      ▼
React UI ◄──────── timeline + hour + daily-rollup indexes
                                 │
                                 ▼ sanitized projection
                     authenticated local MCP server
```

The renderer is sandboxed and communicates through a narrow typed preload bridge. Structured model outputs are validated before persistence. Raw events, indexes, Markdown, settings, and agent credentials are restricted to the current macOS user.

Inference inputs, prompts, schemas, limits, providers, and the native worker protocol are versioned and covered by preservation tests. See [the inference architecture](docs/architecture/inference.md) and [model-quality methodology](MODEL_QUALITY.md).

## Privacy model

- Collection can be paused at any time.
- When automatic summaries are enabled and the selected provider has an API key, completed episode evidence is sent directly to that provider about every 12 minutes.
- Chat requests send the conversation and relevant retrieved evidence to the configured cloud provider; questions about very recent work can include privacy-filtered activity not yet covered by a timeline summary.
- OpenAI requests use `store: false`; Anthropic and Kimi requests are governed by their respective API data policies.
- Credentials and credential-shaped text are redacted before persistence or projection.
- Raw activity is excluded from the MCP projection.
- Agent credentials are random, independently revocable, and stored only as SHA-256 hashes.
- The MCP server binds to `127.0.0.1`, requires bearer authentication, and rejects non-local browser origins.

See the complete [privacy policy](PRIVACY.md) and [SECURITY.md](SECURITY.md) for reporting security issues. Startup automatically removes historical protected activity and invalid derived summaries. To run that raw-event scrub manually, use:

```bash
npm run privacy:scrub-protected -- "/path/to/activity-data"
```

## Local agent access

Open **Settings** and choose **Copy prompt**. OpenHistory creates a dedicated credential and copies a short configuration prompt for your local coding agent. The credential is placed in the `Authorization` header, never in the MCP URL.

The default endpoint is `http://127.0.0.1:47831/openhistory/mcp`. Set `OPENHISTORY_MCP_PORT` in `.env.local` to use a different loopback port.

Available read-only tools:

- `search_history`
- `get_day`
- `get_timeline_item`
- `find_surfaces`
- `get_unfinished_work`

## Local data

OpenHistory uses Electron's per-user application data directory by default. Set `OPENHISTORY_DATA_DIR` to use a different directory during development; for deletion safety, a custom path must end in `activity-data`. OpenHistory refuses to mark an existing, nonempty custom directory as owned unless `OPENHISTORY_ADOPT_DATA_DIR=1` is also set deliberately. Existing installations in the recognized original `local-computer-history` directory continue migrating automatically.

```text
events-YYYY-MM-DD.jsonl   raw local activity
timeline/                validated summaries and provenance
hours/                   validated clock-hour rollups
daily-rollups/           validated daily rollups
agent-projection/        redacted agent-facing index
agent-access.json        credential hashes and access audit
inference-settings.json selected provider, models, and enabled state
openai-credential.json  macOS-encrypted OpenAI credential
anthropic-credential.json macOS-encrypted Anthropic credential
kimi-credential.json    macOS-encrypted Kimi credential
```

Raw JSONL remains the source of truth. Timeline items reference their exact source event IDs, while hourly and daily rollups independently reference revisions of verified timeline items. Stale derived data is not shown or sent back to the model. Existing version-1 data in `memory/` is imported into `daily-rollups/` on first launch after upgrading.

Use **Settings > Data & privacy > Delete all local data** to remove raw activity, summaries, settings, saved keys, and agent connections. OpenHistory confirms the action natively and restarts. For a full uninstall, delete local data first, remove the app, then remove its Accessibility permission in System Settings.

## Desktop distribution spike

The repository includes a credential-free ToDesktop Platform spike for signed macOS packaging and updates. It isolates the release CLI from the application dependency tree, builds optimized ARM64/x64 Swift helpers, embeds the collector as a stable nested application before signing, and uses an explicit upload manifest that excludes local data and private evaluation assets. See [the ToDesktop release guide](docs/releasing-todesktop.md).

Build a complete runnable application locally without ToDesktop credentials or an upload:

```bash
npm run desktop:package:local
```

The verified, ad-hoc-signed application is written under `.todesktop/local/`. It contains only compiled application output, production dependencies, the public icon, and the nested release-mode native helper.

## Development

```bash
npm test          # typecheck + TypeScript tests + Swift tests
npm run build     # native collector + Electron production bundles
npm run check     # complete local quality gate
npm run test:inference-preservation # exact Apple/cloud task contracts
```

Deletion tests use only synthetic temporary directories. Never use the live app directory or a private evaluation corpus as a test target. Repository fixtures, private evaluation data, and developer backups must remain outside every configured `activity-data` root.

The event-quality benchmark prints aggregate metrics without captured content:

```bash
npm run benchmark:events -- "/path/to/activity-data"
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

OpenHistory is licensed under the [Apache License 2.0](LICENSE).
