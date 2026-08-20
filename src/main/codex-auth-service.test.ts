import assert from "node:assert/strict";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { CodexAuthService, safeOpenAIAuthUrl } from "./codex-auth-service";

test("completes managed ChatGPT login through the isolated app-server", async (context) => {
  const directory = await testDirectory(context);
  const executablePath = resolve(directory, "fake-codex");
  writeFileSync(executablePath, `#!/usr/bin/env node
const readline = require("node:readline");
let signedIn = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") send({ id: request.id, result: { userAgent: "fake", codexHome: process.env.CODEX_HOME } });
  if (request.method === "account/read") send({ id: request.id, result: { account: signedIn ? { type: "chatgpt", email: "person@example.com", planType: "plus" } : null, requiresOpenaiAuth: true } });
  if (request.method === "account/login/start") {
    send({ id: request.id, result: { type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/oauth/authorize" } });
    setTimeout(() => { signedIn = true; send({ method: "account/login/completed", params: { loginId: "login-1", success: true, error: null } }); }, 10);
  }
  if (request.method === "account/logout") { signedIn = false; send({ id: request.id, result: {} }); }
  if (request.method === "account/login/cancel") send({ id: request.id, result: { status: "canceled" } });
});
`, { mode: 0o700 });
  chmodSync(executablePath, 0o700);

  const service = new CodexAuthService({
    codexHome: resolve(directory, "codex"),
    executablePath,
    workingDirectory: resolve(directory, "workspace")
  }, "test");
  context.after(() => service.stop());

  await service.start();
  assert.equal(service.getState().status, "signedOut");
  const connected = new Promise<void>((resolveConnected) => {
    service.on("state", (state) => {
      if (state.status === "signedIn") resolveConnected();
    });
  });
  assert.equal(await service.signIn(), "https://auth.openai.com/oauth/authorize");
  await connected;
  assert.deepEqual(service.getState(), {
    status: "signedIn",
    email: "person@example.com",
    planType: "plus"
  });

  await service.logout();
  assert.equal(service.getState().status, "signedOut");
});

test("accepts only OpenAI and ChatGPT HTTPS login destinations", () => {
  assert.equal(
    safeOpenAIAuthUrl("https://auth.openai.com/oauth/authorize"),
    "https://auth.openai.com/oauth/authorize"
  );
  assert.equal(safeOpenAIAuthUrl("https://chatgpt.com/auth/login"), "https://chatgpt.com/auth/login");
  assert.equal(safeOpenAIAuthUrl("http://auth.openai.com/login"), undefined);
  assert.equal(safeOpenAIAuthUrl("https://openai.com.evil.example/login"), undefined);
  assert.equal(safeOpenAIAuthUrl("https://person:secret@auth.openai.com/login"), undefined);
});

async function testDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-codex-auth-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
