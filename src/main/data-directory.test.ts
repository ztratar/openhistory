import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  DATA_ROOT_MARKER,
  deleteOwnedDataDirectory,
  ensureOwnedDataDirectory
} from "./data-directory";

test("deletes only owned synthetic activity data and recreates an empty private root", async (context) => {
  const root = await testRoot(context);
  const directory = resolve(root, "OpenHistory Test", "activity-data");
  const sibling = resolve(root, "evaluation-corpus.json");
  ensureOwnedDataDirectory(directory);
  mkdirSync(resolve(directory, "timeline"));
  writeFileSync(resolve(directory, "timeline", "synthetic.json"), "private synthetic text");
  writeFileSync(sibling, "must survive");

  deleteOwnedDataDirectory(directory);

  assert.equal(existsSync(resolve(directory, "timeline", "synthetic.json")), false);
  assert.equal(existsSync(resolve(directory, DATA_ROOT_MARKER)), true);
  assert.equal(existsSync(sibling), true);
});

test("refuses to delete an unowned directory and preserves its files", async (context) => {
  const root = await testRoot(context);
  const directory = resolve(root, "OpenHistory Test", "activity-data");
  mkdirSync(directory, { recursive: true });
  const protectedFile = resolve(directory, "development-evaluation.json");
  writeFileSync(protectedFile, "preserve me");

  assert.throws(() => deleteOwnedDataDirectory(directory), /ownership marker/);
  assert.equal(existsSync(protectedFile), true);
});

test("refuses to adopt a nonempty unowned directory without explicit approval", async (context) => {
  const root = await testRoot(context);
  const directory = resolve(root, "Custom", "activity-data");
  mkdirSync(directory, { recursive: true });
  const protectedFile = resolve(directory, "evaluation-corpus.json");
  writeFileSync(protectedFile, "preserve me");

  assert.throws(() => ensureOwnedDataDirectory(directory), /without explicit approval/);
  assert.equal(existsSync(protectedFile), true);
  assert.equal(existsSync(resolve(directory, DATA_ROOT_MARKER)), false);
});

test("adopts a nonempty directory only after explicit approval", async (context) => {
  const root = await testRoot(context);
  const directory = resolve(root, "Migrated OpenHistory", "activity-data");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "events-2026-08-15.jsonl"), "synthetic history");

  ensureOwnedDataDirectory(directory, { adoptExistingUnmarked: true });

  assert.equal(existsSync(resolve(directory, DATA_ROOT_MARKER)), true);
});

test("refuses broad or ambiguously named deletion targets", async (context) => {
  const root = await testRoot(context);
  assert.throws(() => ensureOwnedDataDirectory(root), /dedicated activity-data/);
  assert.throws(() => deleteOwnedDataDirectory("/"), /dedicated activity-data/);
});

test("does not follow a symbolic link contained in synthetic activity data", async (context) => {
  const root = await testRoot(context);
  const directory = resolve(root, "OpenHistory Test", "activity-data");
  const external = resolve(root, "private-evaluation-data");
  ensureOwnedDataDirectory(directory);
  mkdirSync(external);
  const protectedFile = resolve(external, "corpus.json");
  writeFileSync(protectedFile, "must survive");
  symlinkSync(external, resolve(directory, "linked-evaluation-data"));

  deleteOwnedDataDirectory(directory);

  assert.equal(existsSync(protectedFile), true);
});

async function testRoot(context: TestContext): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "openhistory-delete-test-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
