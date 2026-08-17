import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — OpenHistory",
  description: "How OpenHistory collects, stores, summarizes, exports, and deletes local work history."
};

export default function PrivacyPage() {
  return (
    <main className="policy-page">
      <article>
        <Link className="policy-back" href="/">← OpenHistory</Link>
        <p className="section-label">Privacy policy</p>
        <h1>Your history belongs to you.</h1>
        <p className="policy-updated">Last updated August 16, 2026</p>

        <h2>What the app observes</h2>
        <p>Only after you accept the first-run notice, OpenHistory can observe foreground apps and the macOS Accessibility context you permit. Depending on Settings, that can include window names, focused controls, text changes, clicks, browser URLs or domains, document context, and visible interface text. It does not capture screenshots, camera or microphone input, audio, or low-level keyboard events.</p>

        <h2>Local storage and control</h2>
        <p>Raw activity, summaries, settings, encrypted API keys, and local-agent credentials stay in a permission-restricted directory on your Mac. During first-run setup, email and messaging activity are selected for inclusion by default; you can clear either choice before finishing setup and control both independently later. OpenHistory does not operate analytics or telemetry. You can pause capture, disable capture categories, exclude apps, inspect the folder, export content-free diagnostics, or permanently delete all local OpenHistory data.</p>

        <h2>On-device versus cloud</h2>
        <p>Apple On-Device inference is experimental and keeps evidence on a compatible Mac. OpenAI, Anthropic, and Kimi are optional cloud providers. Before one is enabled, OpenHistory separately asks permission and explains that selected session evidence will be sent directly to that provider. Saving an API key alone does not authorize transmission.</p>

        <h2>Deletion and diagnostics</h2>
        <p><strong>Delete all local data</strong> removes the app-owned activity directory—including history, summaries, settings, keys, and agent connections—after a native confirmation. Safe diagnostics include versions, settings, status, and counts, but exclude activity content, exact paths, error messages, API keys, and agent credentials.</p>

        <h2>Source and security details</h2>
        <p>OpenHistory will link its complete source, storage documentation, uninstall instructions, and security-reporting process here when the public repository is available.</p>
      </article>
    </main>
  );
}
