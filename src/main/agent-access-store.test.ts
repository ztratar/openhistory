import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentAccessStore } from "./agent-access-store";

test("stores only token hashes and enforces independent revocation", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-agent-access-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "agent-access.json");
  const store = new AgentAccessStore(path);
  const first = store.createCredential();
  const second = store.createCredential();

  const stored = readFileSync(path, "utf8");
  assert.equal(stored.includes(first.token), false);
  assert.equal(stored.includes(second.token), false);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(store.authenticate(first.token)?.id, first.connectionId);
  assert.equal(store.authenticate("oh_not-a-real-token"), undefined);

  const used = store.recordAccess(first.connectionId, "search_history", { name: "Test Agent", version: "1.0" });
  assert.equal(used?.accessCount, 1);
  assert.equal(used?.clientName, "Test Agent");
  assert.equal(store.revoke(first.connectionId), true);
  assert.equal(store.authenticate(first.token), undefined);
  assert.equal(store.authenticate(second.token)?.id, second.connectionId);
});
