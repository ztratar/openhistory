import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { privateInferenceFetch, resolvePrivateInferenceHost } from "./private-inference-fetch";

test("rejects private-looking hostnames that resolve to a public address", async () => {
  await assert.rejects(
    resolvePrivateInferenceHost("model.local", async () => [{ address: "203.0.113.10", family: 4 }]),
    /exclusively to private addresses/
  );
});

test("accepts a Tailscale hostname only when DNS resolves privately", async () => {
  const addresses = await resolvePrivateInferenceHost("mini.example.ts.net", async () => [
    { address: "100.64.12.3", family: 4 }
  ]);
  assert.equal(addresses[0]?.address, "100.64.12.3");
});

test("rejects redirects instead of forwarding inference evidence", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(307, { location: "https://example.com/v1/chat/completions" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await assert.rejects(
      privateInferenceFetch(`http://127.0.0.1:${address.port}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ private: "activity evidence" })
      }),
      /redirects are not allowed/
    );
    assert.equal(requests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
