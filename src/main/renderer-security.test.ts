import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedRendererUrl, safeExternalHttpsUrl } from "./renderer-security";

test("trusts only the exact packaged renderer file", () => {
  const renderer = "file:///Applications/OpenHistory.app/Contents/Resources/app.asar/out/renderer/index.html";

  assert.equal(isTrustedRendererUrl(renderer, renderer), true);
  assert.equal(isTrustedRendererUrl(`${renderer}?redirected=true`, renderer), false);
  assert.equal(isTrustedRendererUrl("https://openhistory.sh", renderer), false);
  assert.equal(isTrustedRendererUrl("not a url", renderer), false);
});

test("limits development renderers to the configured origin", () => {
  const production = "file:///Applications/OpenHistory.app/renderer/index.html";
  const development = "http://localhost:5173";

  assert.equal(isTrustedRendererUrl("http://localhost:5173/settings", production, development), true);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173", production, development), false);
  assert.equal(isTrustedRendererUrl("https://localhost:5173", production, development), false);
});

test("opens only credential-free HTTPS destinations externally", () => {
  assert.equal(safeExternalHttpsUrl("https://openhistory.sh/privacy"), "https://openhistory.sh/privacy");
  assert.equal(safeExternalHttpsUrl("https://user:secret@example.com/private"), undefined);
  assert.equal(safeExternalHttpsUrl("http://openhistory.sh"), undefined);
  assert.equal(safeExternalHttpsUrl("javascript:alert(1)"), undefined);
  assert.equal(safeExternalHttpsUrl("not a url"), undefined);
});
