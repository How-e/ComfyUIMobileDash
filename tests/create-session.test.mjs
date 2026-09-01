import assert from "node:assert/strict";
import test from "node:test";
import { defaultCreateSession, parseCreateSession } from "../src/createSession.js";
import { sampleWorkflow } from "../src/sampleWorkflow.js";

test("invalid payloads fall back to the demo Create-tab session", () => {
  const fallback = defaultCreateSession();
  for (const raw of [null, [], { workflow: {} }, { workflow: { "1": { class_type: "KSampler" } } }]) {
    const session = parseCreateSession(raw);
    assert.equal(session.restored, false);
    assert.equal(session.workflowName, fallback.workflowName);
    assert.equal(session.activeTab, "create");
    assert.deepEqual(session.workflow["3"].inputs.seed, sampleWorkflow["3"].inputs.seed);
  }
});

test("restores workflow inputs, name, filters, and tab", () => {
  const workflow = {
    "3": { class_type: "KSampler", inputs: { seed: 99, steps: 12 }, _meta: { controlAfterGenerate: { seed: "increment" } } },
  };
  const session = parseCreateSession({
    workflow,
    workflowName: "Custom image workflow",
    essentialsOnly: false,
    search: "seed",
    activeTab: "create",
  });
  assert.equal(session.restored, true);
  assert.equal(session.workflowName, "Custom image workflow");
  assert.equal(session.essentialsOnly, false);
  assert.equal(session.search, "seed");
  assert.equal(session.activeTab, "create");
  assert.equal(session.workflow["3"].inputs.seed, 99);
  assert.equal(session.workflow["3"]._meta.controlAfterGenerate.seed, "increment");
  session.workflow["3"].inputs.seed = 1;
  assert.equal(workflow["3"].inputs.seed, 99);
});
