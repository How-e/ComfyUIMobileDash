const clone = (value) => JSON.parse(JSON.stringify(value));

const noteTypes = new Set(["MarkdownNote", "Note"]);

export function workflowClassTypes(json) {
  const candidate = json?.output || json?.prompt || json;
  if (candidate && !Array.isArray(candidate) && typeof candidate === "object") {
    const nodes = Object.values(candidate);
    if (nodes.length && nodes.every((node) => node?.class_type && node?.inputs)) {
      return [...new Set(nodes.map((node) => node.class_type))];
    }
  }

  if (!Array.isArray(json?.nodes)) return [];
  const subgraphIds = new Set((json.definitions?.subgraphs || []).map((definition) => definition.id));
  const graphs = [json, ...(json.definitions?.subgraphs || [])];
  return [...new Set(graphs.flatMap((graph) => (graph.nodes || [])
    .filter((node) => (node.mode ?? 0) === 0 && !noteTypes.has(node.type) && !subgraphIds.has(node.type))
    .map((node) => node.type)))];
}

function linksFor(graph) {
  return new Map((graph.links || []).map((link) => {
    if (Array.isArray(link)) {
      return [link[0], { id: link[0], origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4], type: link[5] }];
    }
    return [link.id, link];
  }));
}

function nodeMap(graph) { return new Map((graph.nodes || []).map((node) => [String(node.id), node])); }

function baseSpecEntries(info) {
  const input = info?.input || {};
  const order = info?.input_order;
  const groups = ["required", "optional"];
  return groups.flatMap((group) => {
    const values = input[group] || {};
    const keys = order?.[group] || Object.keys(values);
    return keys.filter((key) => key in values).map((key) => [key, values[key]]);
  });
}

function normalizeConditionalSpec(entry) {
  if (!Array.isArray(entry) || typeof entry[0] !== "string") return null;
  const options = entry[2] && typeof entry[2] === "object" && !Array.isArray(entry[2]) ? entry[2] : {};
  if (Array.isArray(entry[1])) return [entry[0], [entry[1], options]];
  if (typeof entry[1] === "string") return [entry[0], [entry[1], options]];
  return null;
}

export function workflowInputSpecs(info, values = {}) {
  const base = baseSpecEntries(info);
  const dynamic = base.flatMap(([name, spec]) => {
    const formats = spec?.[1]?.formats;
    if (!formats || typeof formats !== "object") return [];
    const selected = values[name] ?? spec?.[1]?.default ?? (Array.isArray(spec?.[0]) ? spec[0][0] : undefined);
    const entries = formats[selected];
    return Array.isArray(entries) ? entries.map(normalizeConditionalSpec).filter(Boolean) : [];
  });
  const seen = new Set();
  return [...base, ...dynamic].filter(([name]) => !seen.has(name) && seen.add(name));
}

export function workflowInputSpec(info, name, values = {}) {
  return workflowInputSpecs(info, values).find(([key]) => key === name)?.[1];
}

function defaultForSpec(spec) {
  const options = spec?.[1] || {};
  if ("default" in options) return clone(options.default);
  if (Array.isArray(spec?.[0]) && spec[0].length) return clone(spec[0][0]);
  if (Array.isArray(options.options) && options.options.length) return clone(options.options[0]);
  return undefined;
}

function conditionalNames(spec) {
  const formats = spec?.[1]?.formats;
  if (!formats || typeof formats !== "object") return [];
  return [...new Set(Object.values(formats).flatMap((entries) => Array.isArray(entries)
    ? entries.map(normalizeConditionalSpec).filter(Boolean).map(([name]) => name)
    : []))];
}

export function updateWorkflowInput(inputs, info, name, value) {
  const next = { ...inputs, [name]: value };
  const controller = baseSpecEntries(info).find(([key]) => key === name)?.[1];
  const names = conditionalNames(controller);
  if (!names.length) return next;
  const previous = { ...inputs };
  names.forEach((key) => { delete next[key]; });
  for (const [key, spec] of workflowInputSpecs(info, next)) {
    if (!names.includes(key)) continue;
    const old = previous[key];
    const choices = Array.isArray(spec?.[0]) ? spec[0] : null;
    if (old !== undefined && (!choices || choices.includes(old))) next[key] = old;
    else {
      const fallback = defaultForSpec(spec);
      if (fallback !== undefined) next[key] = fallback;
    }
  }
  return next;
}

export function isWidgetSpec(spec) {
  const type = spec?.[0];
  return Array.isArray(type) || ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(type);
}

export function isLoraInputValue(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && typeof value.lora === "string"
    && typeof value.on === "boolean"
    && typeof value.strength === "number";
}

export function isWorkflowLink(value) {
  return Array.isArray(value) && value.length === 2
    && ["string", "number"].includes(typeof value[0])
    && Number.isInteger(value[1]);
}

export function containsWorkflowLink(value) {
  if (isWorkflowLink(value)) return true;
  if (Array.isArray(value)) return value.some(containsWorkflowLink);
  if (value && typeof value === "object") return Object.values(value).some(containsWorkflowLink);
  return false;
}

export function isEditableWorkflowValue(value, spec) {
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (isLoraInputValue(value)) return true;
  if (isWidgetSpec(spec) && value !== null && typeof value === "object") return true;
  return value !== null && typeof value === "object" && !containsWorkflowLink(value);
}

export function nextLoraInputName(inputs = {}) {
  const highest = Object.keys(inputs).reduce((max, name) => {
    const match = /^lora_(\d+)$/i.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `lora_${highest + 1}`;
}

export function addLoraInput(inputs, lora) {
  const name = nextLoraInputName(inputs);
  return { ...inputs, [name]: { on: true, lora, strength: 1, strengthTwo: null } };
}

export function removeLoraInput(inputs, name) {
  return Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== name));
}

function appendDynamicLoraWidgets(values, raw) {
  let index = 1;
  for (const value of raw) {
    if (!isLoraInputValue(value)) continue;
    while (`lora_${index}` in values) index += 1;
    values[`lora_${index}`] = clone(value);
    index += 1;
  }
}

const CONTROL_AFTER_GENERATE = new Set(["fixed", "increment", "decrement", "randomize"]);

function controlMode(value) {
  return typeof value === "string" && CONTROL_AFTER_GENERATE.has(value.toLowerCase()) ? value.toLowerCase() : null;
}

function flaggedControlNames(info) {
  return baseSpecEntries(info).filter(([, spec]) => spec?.[1]?.control_after_generate).map(([name]) => name);
}

function fillMissingWidgetDefaults(values, node, info) {
  for (const [name, spec] of workflowInputSpecs(info, values)) {
    if (name in values || !isWidgetSpec(spec)) continue;
    if ((node.inputs || []).some((input) => input.name === name && input.link != null)) continue;
    const fallback = defaultForSpec(spec);
    if (fallback !== undefined) values[name] = fallback;
  }
}

function namedControlAfterGenerate(named, info, validNames) {
  const controlAfterGenerate = {};
  const flagged = flaggedControlNames(info);
  for (const name of flagged) {
    const mode = controlMode(named[`${name}.control_after_generate`]);
    if (mode) controlAfterGenerate[name] = mode;
  }
  if (!validNames.has("control_after_generate")) {
    const mode = controlMode(named.control_after_generate);
    if (mode) {
      const target = flagged.find((name) => !(name in controlAfterGenerate));
      if (target) controlAfterGenerate[target] = mode;
    }
  }
  return controlAfterGenerate;
}

function widgetValues(node, info) {
  const named = node.widgets_values_named && typeof node.widgets_values_named === "object"
    ? node.widgets_values_named
    : node.widgets_values && typeof node.widgets_values === "object" && !Array.isArray(node.widgets_values)
      ? node.widgets_values
      : null;
  if (named) {
    const validNames = new Set(workflowInputSpecs(info, named).map(([name]) => name));
    const values = Object.fromEntries(Object.entries(named)
      .filter(([name, value]) => validNames.has(name) || (/^lora_\d+$/i.test(name) && isLoraInputValue(value)))
      .map(([name, value]) => [name, clone(value)]));
    fillMissingWidgetDefaults(values, node, info);
    return { values, controlAfterGenerate: namedControlAfterGenerate(named, info, validNames) };
  }

  const raw = node.widgets_values === undefined || node.widgets_values === null
    ? []
    : Array.isArray(node.widgets_values) ? node.widgets_values : [node.widgets_values];
  const values = {};
  const controlAfterGenerate = {};
  let cursor = 0;
  for (const [name, spec] of baseSpecEntries(info)) {
    if (!isWidgetSpec(spec)) continue;
    const socket = (node.inputs || []).find((input) => input.name === name);
    if (socket && !socket.widget && socket.link != null) continue;
    if (cursor < raw.length) values[name] = clone(raw[cursor]);
    cursor += 1;
    if (spec?.[1]?.control_after_generate && cursor < raw.length) {
      const mode = controlMode(raw[cursor]);
      if (mode) {
        controlAfterGenerate[name] = mode;
        cursor += 1;
      }
    }
    const formats = spec?.[1]?.formats;
    if (formats && name in values) {
      for (const [dynamicName, dynamicSpec] of (formats[values[name]] || []).map(normalizeConditionalSpec).filter(Boolean)) {
        if (cursor < raw.length) values[dynamicName] = clone(raw[cursor]);
        cursor += 1;
        if (dynamicSpec?.[1]?.control_after_generate && cursor < raw.length) cursor += 1;
      }
    }
  }
  // rgthree's Power Lora Loader exposes a flexible **kwargs API, so its LoRA
  // widgets are intentionally absent from object_info. ComfyUI serializes each
  // configured row as an object in widgets_values; restore the lora_N input
  // names expected by the server instead of silently discarding every row.
  appendDynamicLoraWidgets(values, raw);
  fillMissingWidgetDefaults(values, node, info);
  return { values, controlAfterGenerate };
}

function nextSeedValue(value, mode) {
  if (mode === "fixed") return value;
  if (mode === "increment") return Math.max(0, value + 1);
  if (mode === "decrement") return Math.max(0, value - 1);
  if (mode === "randomize") return Math.floor(Math.random() * 1e15);
  return value;
}

export function applyControlAfterGenerate(workflow) {
  const next = clone(workflow);
  for (const node of Object.values(next)) {
    const modes = node?._meta?.controlAfterGenerate;
    if (!modes || typeof modes !== "object" || !node.inputs) continue;
    for (const [name, mode] of Object.entries(modes)) {
      const current = node.inputs[name];
      if (typeof current !== "number" || !Number.isFinite(current)) continue;
      const resolved = controlMode(mode);
      if (!resolved) continue;
      node.inputs[name] = nextSeedValue(current, resolved);
    }
  }
  return next;
}

function bypassInput(node, outputSlot) {
  const output = node.outputs?.[outputSlot];
  if (!output) return null;
  const exact = (node.inputs || []).find((input) => {
    const outputLabel = output.label || output.localized_name || output.name;
    const inputLabel = input.label || input.localized_name || input.name;
    return input.type === output.type && inputLabel === outputLabel;
  });
  if (exact) return exact;
  const sameType = (node.inputs || []).filter((input) => input.type === output.type);
  return sameType[Math.min(outputSlot, sameType.length - 1)] || null;
}

function makeContext(graph, prefix = "") {
  return { graph, prefix, links: linksFor(graph), nodes: nodeMap(graph) };
}

function outputId(context, id) { return `${context.prefix}${id}`; }

function assignInput(inputs, name, value) {
  // Dots are valid characters in ComfyUI API input names (for example
  // `values.a`); they do not represent nested object paths.
  inputs[name] = value;
}

function linkedNodeIds(value, found = []) {
  if (Array.isArray(value) && value.length === 2 && ["string", "number"].includes(typeof value[0]) && typeof value[1] === "number") {
    found.push(String(value[0]));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((child) => linkedNodeIds(child, found));
  }
  return found;
}

export function convertCanvasWorkflow(workflow, objectInfo) {
  if (!Array.isArray(workflow?.nodes)) throw new Error("This is not a ComfyUI canvas workflow.");
  const definitions = new Map((workflow.definitions?.subgraphs || []).map((definition) => [definition.id, definition]));
  const prompt = {};
  const root = makeContext(workflow);

  function resolveOutput(context, originId, originSlot, instance) {
    if (Number(originId) === -10 && instance) {
      const input = instance.definition.inputs?.[originSlot];
      if (!input) return null;
      const socket = (instance.node.inputs || []).find((item) => item.name === input.name);
      if (socket?.link != null) return resolveLink(instance.parent, socket.link, instance.parentInstance);
      if (!(input.name in instance.values)) return null;
      return { value: clone(instance.values[input.name]), promotedLabel: input.label || input.name };
    }

    const node = context.nodes.get(String(originId));
    if (!node) return null;
    if (node.mode === 4) {
      const input = bypassInput(node, originSlot);
      return input?.link != null ? resolveLink(context, input.link, instance) : null;
    }

    const subgraph = definitions.get(node.type);
    if (subgraph) {
      const inner = makeContext(subgraph, `${outputId(context, node.id)}:`);
      const outputLink = (subgraph.links || []).map((link) => Array.isArray(link)
        ? { origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4] }
        : link).find((link) => Number(link.target_id) === -20 && Number(link.target_slot) === Number(originSlot));
      if (!outputLink) return null;
      const childInstance = createInstance(node, subgraph, context, instance);
      return resolveOutput(inner, outputLink.origin_id, outputLink.origin_slot, childInstance);
    }
    return [outputId(context, node.id), Number(originSlot)];
  }

  function resolveLink(context, linkId, instance) {
    const link = context.links.get(linkId);
    if (!link) return null;
    return resolveOutput(context, link.origin_id, link.origin_slot, instance);
  }

  function createInstance(node, definition, parent, parentInstance) {
    let values = node.widgets_values_named && typeof node.widgets_values_named === "object"
      ? clone(node.widgets_values_named)
      : {};
    if (!Object.keys(values).length) {
      const raw = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      (definition.inputs || []).forEach((input, index) => { if (index < raw.length) values[input.name] = clone(raw[index]); });
    }
    return { node, definition, parent, parentInstance, values };
  }

  function emitGraph(context, instance = null) {
    for (const node of context.graph.nodes || []) {
      if ((node.mode ?? 0) !== 0 || noteTypes.has(node.type)) continue;
      const subgraph = definitions.get(node.type);
      if (subgraph) {
        const childInstance = createInstance(node, subgraph, context, instance);
        emitGraph(makeContext(subgraph, `${outputId(context, node.id)}:`), childInstance);
        continue;
      }
      const info = objectInfo[node.type];
      if (!info) continue;
      const { values: inputs, controlAfterGenerate } = widgetValues(node, info);
      const inputLabels = {};
      for (const socket of node.inputs || []) {
        if (socket.link == null) continue;
        const resolved = resolveLink(context, socket.link, instance);
        if (Array.isArray(resolved)) assignInput(inputs, socket.name, resolved);
        else if (resolved && "value" in resolved) {
          assignInput(inputs, socket.name, resolved.value);
          if (resolved.promotedLabel) inputLabels[socket.name] = resolved.promotedLabel;
        }
      }
      prompt[outputId(context, node.id)] = {
        class_type: node.type,
        inputs,
        _meta: {
          title: node.title || info.display_name || node.type,
          ...(Object.keys(inputLabels).length ? { inputLabels } : {}),
          ...(Object.keys(controlAfterGenerate).length ? { controlAfterGenerate } : {}),
        },
      };
    }
  }

  emitGraph(root);
  const keep = new Set();
  const visit = (id) => {
    if (keep.has(id) || !prompt[id]) return;
    keep.add(id);
    linkedNodeIds(prompt[id].inputs).forEach(visit);
  };
  Object.entries(prompt).filter(([, node]) => objectInfo[node.class_type]?.output_node).forEach(([id]) => visit(id));
  if (keep.size) Object.keys(prompt).forEach((id) => { if (!keep.has(id)) delete prompt[id]; });
  if (!Object.keys(prompt).length) throw new Error("No runnable nodes could be converted from this workflow.");
  return prompt;
}

export function normalizeWorkflow(json, objectInfo = {}) {
  const candidate = json.output || json.prompt || json;
  if (candidate && !Array.isArray(candidate) && typeof candidate === "object") {
    const nodes = Object.values(candidate);
    if (nodes.length && nodes.every((node) => node?.class_type && node?.inputs)) return clone(candidate);
  }
  return convertCanvasWorkflow(json, objectInfo);
}

export function priorityForNode(node) {
  const text = `${node.class_type} ${node._meta?.title || ""}`.toLowerCase();
  const inputNames = Object.keys(node.inputs || {}).map((name) => (node._meta?.inputLabels?.[name] || name).toLowerCase());
  if (text.includes("loadimage") || text.includes("load image")) return 0;
  if (text.includes("textencode") || text.includes("prompt") || inputNames.some((name) => name === "prompt" || name === "text")) return 1;
  if (text.includes("lora")) return 2;
  if (inputNames.some((name) => name.includes("duration"))) return 3;
  if (text.includes("sampler")) return 4;
  return 10;
}
