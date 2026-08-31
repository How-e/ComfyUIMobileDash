const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv"]);
const FILE_KEYS = ["images", "gifs", "videos"];

function extension(filename = "") {
  const base = String(filename).split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function formatLooksVideo(format = "") {
  const value = String(format).toLowerCase();
  if (!value) return false;
  if (value.startsWith("image/")) return false;
  if (VIDEO_EXTS.has(value) || VIDEO_EXTS.has(value.replace(/^\./, ""))) return true;
  return /video\/|\b(?:mp4|webm|mov|mkv|avi|m4v|ogv)\b/.test(value);
}

export function mediaKind(item = {}, extras = {}) {
  const ext = extension(item.filename || item.name);
  if (VIDEO_EXTS.has(ext)) return "video";
  if (formatLooksVideo(item.format || extras.format)) return "video";
  if (extras.animated && VIDEO_EXTS.has(ext)) return "video";
  return "image";
}

export function mediaViewUrl(base, item = {}) {
  const params = new URLSearchParams({
    filename: item.filename || item.name || "",
    subfolder: item.subfolder || "",
    type: item.type || "output",
  });
  return `${base}/view?${params}`;
}

function fileRef(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const filename = item.filename || item.name;
  if (!filename || typeof filename !== "string") return null;
  return { filename, subfolder: item.subfolder || "", type: item.type || "output" };
}

function animatedFlags(output) {
  const raw = output?.animated;
  if (Array.isArray(raw)) return raw.map((value) => value === true);
  return [];
}

function mediaFromOutput(output) {
  if (!output || typeof output !== "object") return [];
  const flags = animatedFlags(output);
  const seen = new Set();
  const files = [];
  for (const key of FILE_KEYS) {
    const list = output[key];
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      const ref = fileRef(item);
      if (!ref) return;
      const id = `${ref.type}:${ref.subfolder}:${ref.filename}`;
      if (seen.has(id)) return;
      seen.add(id);
      const animated = item.animated === true || (key === "images" && flags[index] === true);
      files.push({
        filename: ref.filename,
        subfolder: ref.subfolder,
        type: ref.type,
        kind: mediaKind({ ...item, ...ref }, { animated, format: item.format || output.format }),
        ...(item.format || output.format ? { format: item.format || output.format } : {}),
      });
    });
  }
  return files;
}

export function collectMedia(history, base) {
  const item = Object.values(history || {})[0];
  return Object.values(item?.outputs || {}).flatMap((output) => mediaFromOutput(output)).map((media) => ({
    ...media,
    url: mediaViewUrl(base, media),
  }));
}

export function galleryGenerations(runs, base, limit = 5) {
  return (runs || [])
    .filter((run) => (run.images || []).length)
    .sort((a, b) => (b.completedAt || b.stoppedAt || b.queuedAt || 0) - (a.completedAt || a.stoppedAt || a.queuedAt || 0))
    .slice(0, limit)
    .map((run) => ({
      promptId: run.promptId,
      workflowName: run.workflowName || "Workflow",
      timestamp: run.completedAt || run.stoppedAt || run.queuedAt,
      media: run.images.map((item) => ({
        ...item,
        kind: item.kind || mediaKind(item),
        url: mediaViewUrl(base, item),
      })),
    }));
}
