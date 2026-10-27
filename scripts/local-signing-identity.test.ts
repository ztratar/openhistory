import assert from "node:assert/strict";
import test from "node:test";
import { selectLocalSigningIdentity } from "./local-signing-identity";

const SHA_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SHA_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const output = `  1) ${SHA_A} "Apple Development: developer@example.com (TEAM123)"
     1 valid identities found`;

test("selects the sole Apple Development identity", () => {
  assert.deepEqual(selectLocalSigningIdentity(output), {
    sha1: SHA_A,
    name: "Apple Development: developer@example.com (TEAM123)"
  });
});

test("pins an explicit certificate fingerprint regardless of keychain ordering", () => {
  const multiple = `  1) ${SHA_B} "Apple Development: other@example.com (OTHER)"
  2) ${SHA_A} "Apple Development: developer@example.com (TEAM123)"`;
  assert.equal(selectLocalSigningIdentity(multiple, { expectedSha1: SHA_A })?.sha1, SHA_A);
  assert.throws(() => selectLocalSigningIdentity(multiple), /Multiple Apple Development identities/);
});

test("rejects a missing configured certificate", () => {
  assert.throws(() => selectLocalSigningIdentity(output, { expectedSha1: SHA_B }), /not available/);
});

test("does not select Developer ID for a local development package", () => {
  const developerId = `  1) ${SHA_A} "Developer ID Application: developer@example.com (TEAM123)"`;
  assert.equal(selectLocalSigningIdentity(developerId), undefined);
});
