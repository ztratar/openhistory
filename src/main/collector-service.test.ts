import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { CollectorService, type NativeCollectorBinding } from "./collector-service";
import { DEFAULT_COLLECTION_SETTINGS } from "./settings-store";

class FakeNativeCollector implements NativeCollectorBinding {
  starts: Array<{ dataDirectory: string; configuration: Record<string, unknown> }> = [];
  stopCount = 0;
  requestCount = 0;
  trusted = true;

  startCollector(
    dataDirectory: string,
    configurationJSON: string,
    onEvent: (line: string) => void
  ): boolean {
    this.starts.push({
      dataDirectory,
      configuration: JSON.parse(configurationJSON) as Record<string, unknown>
    });
    onEvent(JSON.stringify({
      version: 1,
      id: `collector-start-${this.starts.length}`,
      timestamp: "2026-08-16T12:00:00Z",
      kind: "collector_started",
      accessibilityTrusted: this.trusted
    }));
    return true;
  }

  stopCollector(): void {
    this.stopCount += 1;
  }

  isTrusted(): boolean {
    return this.trusted;
  }

  requestTrust(): boolean {
    this.requestCount += 1;
    return this.trusted;
  }
}

test("runs the collector inside the host identity and forwards native events", async (context) => {
  const directory = await testDirectory(context);
  const native = new FakeNativeCollector();
  const collector = new CollectorService(directory, {
    ...DEFAULT_COLLECTION_SETTINGS,
    captureEmailActivity: true,
    captureMessagingActivity: true
  }, native);
  context.after(() => collector.stop());

  const eventKinds: string[] = [];
  collector.on("event", (event) => eventKinds.push(event.kind));
  collector.start();

  assert.equal(collector.state, "running");
  assert.equal(collector.accessibilityTrusted, true);
  assert.deepEqual(eventKinds, ["collector_started"]);
  assert.equal(native.starts.length, 1);
  const start = native.starts[0];
  assert(start);
  assert.equal(start.dataDirectory, directory);
  assert.deepEqual(start.configuration.excludedProcessIdentifiers, [process.pid]);
  assert.equal(start.configuration.captureEmailActivity, true);
  assert.equal(start.configuration.captureMessagingActivity, true);
});

test("restarts the embedded collector when settings change", async (context) => {
  const directory = await testDirectory(context);
  const native = new FakeNativeCollector();
  const collector = new CollectorService(directory, DEFAULT_COLLECTION_SETTINGS, native);
  context.after(() => collector.stop());

  collector.start();
  collector.setSettings({
    ...DEFAULT_COLLECTION_SETTINGS,
    captureTextInput: false
  });

  assert.equal(native.stopCount, 1);
  assert.equal(native.starts.length, 2);
  const restart = native.starts[1];
  assert(restart);
  assert.equal(restart.configuration.captureTextInput, false);
});

test("requests Accessibility through the host process bridge", async (context) => {
  const directory = await testDirectory(context);
  const native = new FakeNativeCollector();
  const collector = new CollectorService(directory, DEFAULT_COLLECTION_SETTINGS, native);
  context.after(() => collector.stop());

  collector.requestAccessibilityPermission();

  assert.equal(native.requestCount, 1);
});

async function testDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "openhistory-collector-service-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
