import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { ApiKeyStore } from "./api-key-store";

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
};

test("stores an encrypted API key and can return to the environment fallback", async (context) => {
  const directory = await testDirectory(context);
  const store = new ApiKeyStore(directory, encryption);
  const apiKey = "sk-test-secret-that-must-not-be-stored-directly";

  store.save(apiKey);
  assert.equal(store.load(), apiKey);
  assert.equal(readFileSync(resolve(directory, "openai-credential.json"), "utf8").includes(apiKey), false);

  store.clear();
  assert.equal(store.load(), undefined);
});

test("keeps credentials isolated by provider", async (context) => {
  const directory = await testDirectory(context);
  const openAI = new ApiKeyStore(directory, encryption, "openai");
  const anthropic = new ApiKeyStore(directory, encryption, "anthropic");
  const kimi = new ApiKeyStore(directory, encryption, "kimi");

  openAI.save("sk-openai-test-secret-that-is-long-enough");
  anthropic.save("sk-anthropic-test-secret-that-is-long-enough");
  kimi.save("sk-kimi-test-secret-that-is-long-enough");

  assert.match(openAI.load()!, /openai/);
  assert.match(anthropic.load()!, /anthropic/);
  assert.match(kimi.load()!, /kimi/);
  anthropic.clear();
  assert.equal(anthropic.load(), undefined);
  assert.notEqual(openAI.load(), undefined);
  assert.notEqual(kimi.load(), undefined);
});

async function testDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-api-key-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
