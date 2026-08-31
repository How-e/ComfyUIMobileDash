function titleFor(node) {
  return node?._meta?.title || node?.class_type?.replace(/([a-z])([A-Z])/g, "$1 $2") || "Node";
}

function labelFor(node, key) {
  return (node?._meta?.inputLabels?.[key] || key).replaceAll("_", " ");
}

export function promptBridgeTargets(workflow = {}) {
  const prompts = [];
  const images = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [key, value] of Object.entries(node?.inputs || {})) {
      if (typeof value !== "string") continue;
      const normalizedKey = key.toLowerCase();
      const target = { id: `${nodeId}:${key}`, nodeId, key, value, label: `${titleFor(node)} · ${labelFor(node, key)}` };
      if (normalizedKey.includes("prompt") || normalizedKey.includes("text")) prompts.push(target);
      if (normalizedKey === "image" || normalizedKey.endsWith("_image")) images.push(target);
    }
  }
  return { prompts, images };
}

export function comfyImageViewPath(reference) {
  const raw = String(reference || "").trim();
  if (!raw) throw new Error("The selected workflow image is empty.");
  const suffix = raw.match(/\s+\[(input|output|temp)\]$/i);
  const type = suffix?.[1]?.toLowerCase() || "input";
  const clean = (suffix ? raw.slice(0, suffix.index) : raw).replaceAll("\\", "/");
  const slash = clean.lastIndexOf("/");
  const filename = slash >= 0 ? clean.slice(slash + 1) : clean;
  const subfolder = slash >= 0 ? clean.slice(0, slash) : "";
  if (!filename) throw new Error("The selected workflow image has no filename.");
  return `/view?${new URLSearchParams({ filename, subfolder, type })}`;
}
