import test from "node:test";
import assert from "node:assert/strict";
import { activeQueueState, getPersistentClientId } from "../src/queueRecovery.js";

test("reuses the ComfyUI client ID across page reloads", () => {
  const values = new Map([["comfydeck.clientId", "existing-client"]]);
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getPersistentClientId(storage, () => "new-client"), "existing-client");
});

test("creates and saves a ComfyUI client ID once", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getPersistentClientId(storage, () => "new-client"), "new-client");
  assert.equal(values.get("comfydeck.clientId"), "new-client");
});

test("identifies whether the restored prompt is running or pending", () => {
  const jobs = [
    { promptId: "running-id", running: true },
    { promptId: "pending-id", running: false },
  ];

  assert.equal(activeQueueState("running-id", jobs), "running");
  assert.equal(activeQueueState("pending-id", jobs), "pending");
  assert.equal(activeQueueState("finished-id", jobs), "missing");
  assert.equal(activeQueueState("", jobs), "none");
});
