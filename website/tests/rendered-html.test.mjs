import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the OpenHistory landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>OpenHistory — Remember everything<\/title>/i);
  assert.match(html, /Remember everything\./);
  assert.match(html, /Privacy by design/);
  assert.match(html, /On-device inference available/);
  assert.match(html, /What was I working on before lunch/);
  assert.match(html, /Claude Cowork/);
  assert.match(html, /ChatGPT Desktop/);
  assert.match(html, /local MCP server/);
  assert.match(html, /Follow for updates on OpenHistory/);
  assert.match(html, /https:\/\/github\.com\/ztratar\/openhistory/);
  assert.match(html, /https:\/\/x\.com\/zachtratar/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("server-renders the public privacy policy", async () => {
  const response = await render("/privacy");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Your history belongs to you/);
  assert.match(html, /Saving an API key alone does not authorize transmission/);
  assert.match(html, /Delete all local data/);
});

test("ships OpenHistory metadata and social assets", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../public/openhistory-icon.png", import.meta.url)),
    access(new URL("../public/openhistory-icon-32.png", import.meta.url)),
    access(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(layout, /OpenHistory — Remember everything/);
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.match(layout, /metadataBase:/);
  assert.match(layout, /canonical:/);
  assert.match(layout, /@zachtratar/);
  assert.match(page, /On-device by default/);
  assert.match(page, /Turn your mac activity into a private timeline for you &amp; your AI\./);
  assert.doesNotMatch(page, /Raw history stays on your Mac\. Always\./);
  assert.match(page, /Download for Mac/);
  assert.match(page, /href="\/privacy"/);
});
