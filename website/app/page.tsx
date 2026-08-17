import { Braces, CameraOff, Code2, Cpu, Pause, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import { XFollowButton } from "./x-follow-button";

const macDownloadUrl = "https://dl.todesktop.com/260815ukaa3eq/mac/installer/universal";

const privacyPrinciples = [
  {
    icon: CameraOff,
    title: "No screenshots",
    copy: "OpenHistory reads permitted activity context—not your screen, camera, microphone, or keystrokes.",
  },
  {
    icon: Pause,
    title: "Pause at any time",
    copy: "Collection is always visible and always yours to stop. One click pauses the entire system.",
  },
  {
    icon: Cpu,
    title: "On-device inference available",
    copy: "Summaries can run on-device. External inference providers are optional and entirely under your control.",
  },
  {
    icon: Braces,
    title: "Source release planned",
    copy: "The source and implementation details will be published after the initial macOS release is stable.",
  },
];

const workflow = [
  {
    number: "01",
    title: "OpenHistory observes",
    copy: "It notices the apps, windows, and permitted context that make up a working session.",
  },
  {
    number: "02",
    title: "Your Mac summarizes",
    copy: "Activity becomes a concise timeline of completed work, decisions, and unfinished work.",
  },
  {
    number: "03",
    title: "Your agent can search",
    copy: "Ask natural-language questions and get grounded answers from your own local history.",
  },
];

export default function Home() {
  return (
    <>
      <header className="top-bar">
        <a className="top-bar-brand" href="#hero-title" aria-label="OpenHistory home">
          <Image src="/openhistory-icon.png" width={30} height={30} alt="" aria-hidden="true" priority />
          <span>OpenHistory</span>
        </a>
        <nav className="top-bar-nav" aria-label="Primary navigation">
          <a href="#privacy">Privacy</a>
          <a href="#how-it-works">How it works</a>
          <a className="top-bar-download" href={macDownloadUrl} aria-label="Download OpenHistory for Mac">
            <span className="top-bar-apple" aria-hidden="true"></span>
            Download for Mac
          </a>
        </nav>
      </header>

      <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-content">
          <div className="product-brand" aria-label="OpenHistory">
            <Image className="product-mark" src="/openhistory-icon.png" width={64} height={64} alt="" aria-hidden="true" priority />
          </div>
          <h1 id="hero-title">Your automatic work timeline.</h1>
          <p className="hero-copy">Turn your mac activity into a private timeline for you &amp; your AI.</p>

          <div className="trust-row" aria-label="Product principles">
            <span><i className="trust-icon" aria-hidden="true"><ShieldCheck /></i> On-device by default</span>
            <span><i className="trust-icon" aria-hidden="true"><Code2 /></i> Source release planned</span>
            <span><i className="trust-icon" aria-hidden="true"><SlidersHorizontal /></i> Full control</span>
          </div>

          <a className="download-button" href={macDownloadUrl} aria-label="Download OpenHistory for Mac">
            <span className="apple" aria-hidden="true"></span>
            Download for Mac
          </a>
        </div>
        <div className="hero-mobile-timeline" aria-hidden="true" />
      </section>

      <aside className="updates-banner" aria-label="OpenHistory updates">
        <div className="updates-banner-inner">
          <p>Follow for updates on OpenHistory</p>
          <XFollowButton className="updates-follow" />
        </div>
      </aside>

      <section className="privacy-section" id="privacy" aria-labelledby="privacy-title">
        <div className="section-shell">
          <p className="section-label">Privacy by design</p>
          <div className="section-intro">
            <h2 id="privacy-title">Your history<br />belongs to you.</h2>
            <p>OpenHistory was built on a simple belief: remembering your work should never mean giving up ownership of your data.</p>
          </div>

          <div className="principles-grid">
            {privacyPrinciples.map((principle) => {
              const PrincipleIcon = principle.icon;

              return (
                <article className="principle" key={principle.title}>
                  <span className="principle-icon" aria-hidden="true"><PrincipleIcon /></span>
                  <h3>{principle.title}</h3>
                  <p>{principle.copy}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="day-section" id="how-it-works" aria-labelledby="day-title">
        <div className="day-orb orb-left" aria-hidden="true" />
        <div className="day-orb orb-right" aria-hidden="true" />
        <div className="section-shell day-shell">
          <div className="day-heading">
            <p className="section-label light">How it works</p>
            <h2 id="day-title">Your day<br />belongs to you.</h2>
            <p>Stay focused on the work. OpenHistory quietly turns the day into a useful daily rollup in the background.</p>
          </div>

          <div className="workflow-list">
            {workflow.map((item) => (
              <article className="workflow-item" key={item.number}>
                <span>{item.number}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="agent-question">
            <div className="agent-mark" aria-hidden="true">✦</div>
            <div>
              <p>Ask your local agent</p>
              <strong>“What was I working on before lunch?”</strong>
            </div>
            <span className="answer-status"><i /> Answered from OpenHistory</span>
            <p className="agent-compatibility">Works with Claude Cowork, ChatGPT Desktop, and any other agent that can access your local MCP server.</p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <p>Local-first. Built for macOS.</p>
        <h2>Remember everything.</h2>
        <a className="download-button dark" href={macDownloadUrl}>
          <span className="apple" aria-hidden="true"></span>
          Download for Mac
        </a>
      </section>

        <footer>
        <span className="footer-brand">OpenHistory</span>
        <div className="footer-center">
          <nav className="footer-links" aria-label="Footer">
            <a href="/privacy">Privacy</a>
          </nav>
          <XFollowButton className="footer-follow" />
        </div>
        <span className="footer-year">© 2026</span>
        </footer>
      </main>
    </>
  );
}
