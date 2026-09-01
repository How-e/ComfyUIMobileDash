const MODEL_TERMS = ["model", "checkpoint", "unet", "vae", "clip", "lora", "adapter", "controlnet"];
const SETTINGS_TERMS = ["duration", "length", "frames", "frame", "fps", "width", "height", "size", "steps", "cfg", "guidance", "seed", "denoise", "sampler", "scheduler", "codec", "format"];

function searchableNodeText(node) {
  const labels = Object.entries(node?.inputs || {})
    .filter(([, value]) => !(Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && Number.isInteger(value[1])))
    .flatMap(([name]) => [name, node?._meta?.inputLabels?.[name] || ""]);
  return `${node?.class_type || ""} ${node?._meta?.title || ""} ${labels.join(" ")}`.toLowerCase();
}

export function essentialStepForNode(node) {
  const text = searchableNodeText(node);
  if (text.includes("loadimage") || text.includes("load image") || Object.keys(node?.inputs || {}).some((name) => name.toLowerCase() === "image")) return "image";
  if (text.includes("textencode") || text.includes("prompt") || Object.keys(node?.inputs || {}).some((name) => ["prompt", "text"].includes(name.toLowerCase()))) return "prompt";
  if (MODEL_TERMS.some((term) => text.includes(term))) return "model";
  if (SETTINGS_TERMS.some((term) => text.includes(term))) return "settings";
  return "advanced";
}

export const ESSENTIAL_STEPS = [
  { id: "image", number: 1, title: "Image", description: "Choose the source or reference image for this run." },
  { id: "prompt", number: 2, title: "Prompt", description: "Describe the output you want ComfyUI to create." },
  { id: "settings", number: 3, title: "Duration & settings", description: "Set timing, dimensions, sampling, and seed behavior." },
  { id: "model", number: 4, title: "Model", description: "Review model, VAE, LoRA, and adapter choices." },
];

export function groupEssentialNodes(nodes) {
  const groups = Object.fromEntries([...ESSENTIAL_STEPS.map(({ id }) => [id, []]), ["advanced", []]]);
  nodes.forEach((node) => groups[essentialStepForNode(node)].push(node));
  return groups;
}
