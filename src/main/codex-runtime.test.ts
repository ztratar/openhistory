import assert from "node:assert/strict";
import test from "node:test";
import { codexEnvironment } from "./codex-runtime";

test("isolates Codex from ambient API credentials while preserving network plumbing", () => {
  const environment = codexEnvironment("/private/openhistory/codex", {
    PATH: "/usr/bin",
    HTTPS_PROXY: "https://proxy.example",
    OPENAI_API_KEY: "must-not-leak",
    CODEX_API_KEY: "must-not-leak-either"
  });

  assert.equal(environment.CODEX_HOME, "/private/openhistory/codex");
  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.HTTPS_PROXY, "https://proxy.example");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.CODEX_API_KEY, undefined);
});
