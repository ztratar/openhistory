import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DailyRollupItem, TimelineItem } from "@shared/contracts";
import { AgentAccessStore } from "./agent-access-store";
import { AgentMcpService } from "./agent-mcp-service";
import { AgentProjectionStore } from "./agent-projection";

test("serves authenticated read-only MCP tools from the sanitized projection", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "openhistory-mcp-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const access = new AgentAccessStore(join(directory, "agent-access.json"));
  const projection = new AgentProjectionStore(
    join(directory, "projection"),
    { loadAll: () => [timelineFixture()] },
    { loadAll: () => [dailyRollupFixture()] }
  );
  const service = new AgentMcpService(projection, access, { port: 0 });
  context.after(() => service.stop());
  const state = await service.start();
  assert.equal(state.status, "running");
  const endpoint = service.getState().endpoint;
  assert.ok(endpoint);
  assert.equal(new URL(endpoint).pathname, "/openhistory/mcp");

  const setup = service.createSetup();
  const setupConnection = setup.state.connections[0];
  assert.ok(setupConnection);
  assert.match(setup.prompt, new RegExp(`Endpoint: ${endpoint.replaceAll(".", "\\.")}`));
  assert.match(setup.prompt, /Authorization header: Bearer oh_/);
  const setupToken = setup.prompt.match(/Bearer (oh_[A-Za-z0-9_-]+)/)?.[1];
  assert.ok(setupToken);
  assert.equal(endpoint.includes(setupToken), false);
  assert.ok(access.authenticate(setupToken));

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  });
  assert.equal(unauthorized.status, 401);

  const credential = access.createCredential();
  const rejectedOrigin = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential.token}`,
      "content-type": "application/json",
      origin: "https://attacker.example"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  });
  assert.equal(rejectedOrigin.status, 403);

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${credential.token}` } }
  });
  const client = new Client({ name: "OpenHistory integration test", version: "1.0.0" });
  await client.connect(transport);
  context.after(() => client.close());

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["find_surfaces", "get_day", "get_timeline_item", "get_unfinished_work", "search_history"]
  );
  assert.equal(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);

  const response = await client.callTool({ name: "search_history", arguments: { query: "prototype" } });
  const structured = response.structuredContent as { items?: Array<{ title: string }> };
  assert.equal(structured.items?.some((item) => item.title.includes("Prototype")), true);
  assert.equal(JSON.stringify(response).includes("event-raw-secret"), false);

  const surfacesResponse = await client.callTool({ name: "find_surfaces", arguments: { query: "projection" } });
  assert.equal(JSON.stringify(surfacesResponse).includes('"surface":"agent-projection.ts"'), true);

  const unfinishedWorkResponse = await client.callTool({ name: "get_unfinished_work", arguments: {} });
  assert.equal(JSON.stringify(unfinishedWorkResponse).includes('"unfinishedWork":"Test another client"'), true);
  assert.equal(JSON.stringify(unfinishedWorkResponse).includes("openLoop"), false);

  const connection = access.list().find((candidate) => candidate.id === credential.connectionId);
  assert.equal(connection?.clientName, "OpenHistory integration test");
  assert.equal((connection?.accessCount ?? 0) > 0, true);
  assert.equal(access.revoke(credential.connectionId), true);

  const revoked = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });
  assert.equal(revoked.status, 401);
});

function timelineFixture(): TimelineItem {
  return {
    version: 1,
    id: "timeline-test",
    startTime: "2026-08-14T17:00:00.000Z",
    endTime: "2026-08-14T17:10:00.000Z",
    title: "Prototype implementation",
    description: "Implemented the local projection",
    applications: [{ bundleIdentifier: "com.example.Editor", name: "Editor" }],
    workThreads: ["Agent access"],
    decisions: ["Use a projection"],
    outcomes: ["MCP available"],
    blockers: [],
    surfaces: ["agent-projection.ts"],
    suggestion: null,
    sourceEventIds: ["event-raw-secret"]
  };
}

function dailyRollupFixture(): DailyRollupItem {
  return {
    version: 2,
    id: "2026-08-14",
    date: "2026-08-14",
    title: "Prototype daily rollup",
    summary: "Built agent access",
    themes: ["Prototype"],
    accomplishments: ["Connected MCP"],
    decisions: [],
    unfinishedWork: ["Test another client"],
    recurringPatterns: [],
    sourceTimelineIds: ["timeline-test"],
    sourceTimelineRevisions: ["timeline-test:revision"],
    updatedAt: "2026-08-14T18:00:00.000Z"
  };
}
