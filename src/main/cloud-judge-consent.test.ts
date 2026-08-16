import assert from "node:assert/strict";
import test from "node:test";
import { explicitCloudJudgeKey } from "./inference/cloud-judge-consent";

test("keeps cloud judging off when a normal provider key is present", () => {
  assert.equal(explicitCloudJudgeKey([], "sk-synthetic-provider-key"), undefined);
});

test("requires both an explicit cloud-judge flag and a configured key", () => {
  assert.throws(() => explicitCloudJudgeKey(["--cloud-judge"]), /OPENAI_API_KEY/);
  assert.equal(
    explicitCloudJudgeKey(["--cloud-judge"], "  sk-synthetic-judge-key  "),
    "sk-synthetic-judge-key"
  );
});
