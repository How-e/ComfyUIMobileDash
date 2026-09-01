import { sampleWorkflow } from "./sampleWorkflow.js";

export const CREATE_SESSION_KEY = "comfydeck.createSession";

const clone = (value) => JSON.parse(JSON.stringify(value));
const TABS = new Set(["overview", "create", "prompt", "queue", "gallery"]);

export function defaultCreateSession() {
  return {
    workflow: clone(sampleWorkflow),
    workflowName: "Portrait Lab",
    essentialsOnly: true,
    search: "",
    activeTab: "create",
    restored: false,
  };
}

function isRunnableWorkflow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nodes = Object.values(value);
  return nodes.length > 0 && nodes.every((node) => (
    node
    && typeof node === "object"
    && typeof node.class_type === "string"
    && node.inputs
    && typeof node.inputs === "object"
    && !Array.isArray(node.inputs)
  ));
}

export function parseCreateSession(raw) {
  const fallback = defaultCreateSession();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  if (!isRunnableWorkflow(raw.workflow)) return fallback;
  return {
    workflow: clone(raw.workflow),
    workflowName: typeof raw.workflowName === "string" && raw.workflowName.trim() ? raw.workflowName : fallback.workflowName,
    // Restored workflows always reopen in the guided mobile path. Advanced is an
    // explicit per-session choice so a dense prior view never becomes the default.
    essentialsOnly: true,
    search: typeof raw.search === "string" ? raw.search : fallback.search,
    activeTab: TABS.has(raw.activeTab) ? raw.activeTab : fallback.activeTab,
    restored: true,
  };
}

export function writeCreateSession(key, session) {
  try {
    localStorage.setItem(key, JSON.stringify({
      workflow: session.workflow,
      workflowName: session.workflowName,
      essentialsOnly: session.essentialsOnly,
      search: session.search,
      activeTab: session.activeTab,
    }));
  } catch { /* Keep in-memory Create-tab state if storage is full. */ }
}
