const clone = (value) => JSON.parse(JSON.stringify(value));

const noteTypes = new Set(["MarkdownNote", "Note"]);

function linksFor(graph) {
  return new Map((graph.links || []).map((link) => {
    if (Array.isArray(link)) {
      return [link[0], { id: link[0], origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4], type: link[5] }];
    }
    return [link.id, link];
  }));
}

function nodeMap(graph) { return new Map((graph.nodes || []).map((node) => [String(node.id), node])); }

function specEntries(info) {
  const input = info?.input || {};
  const order = info?.input_order;
  const groups = ["required", "optional"];
  return groups.flatMap((group) => {
    const values = input[group] || {};
    const keys = order?.[group] || Object.keys(values);
    return keys.filter((key) => key in values).map((key) => [key, values[key]]);
  });
}

function isWidgetSpec(spec) {
  const type = spec?.[0];
  return Array.isArray(type) || ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(type);
}

function widgetValues(node, info) {
  const validNames = new Set(specEntries(info).map(([name]) => name));
  if (node.widgets_values_named && typeof node.widgets_values_named === "object") {
    return Object.fromEntries(Object.entries(node.widgets_values_named).filter(([name]) => validNames.has(name)));
  }

  const raw = node.widgets_values === undefined || node.widgets_values === null
    ? []
    : Array.isArray(node.widgets_values) ? node.widgets_values : [node.widgets_values];
  const values = {};
  let cursor = 0;
  for (const [name, spec] of specEntries(info)) {
    if (!isWidgetSpec(spec)) continue;
    const socket = (node.inputs || []).find((input) => input.name === name);
    if (socket && !socket.widget && socket.link != null) continue;
    if (cursor < raw.length) values[name] = clone(raw[cursor]);
    cursor += 1;
    if (spec?.[1]?.control_after_generate && cursor < raw.length) cursor += 1;
  }
  return values;
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
  const [root, ...rest] = name.split(".");
  if (!rest.length) { inputs[root] = value; return; }
  inputs[root] = inputs[root] && typeof inputs[root] === "object" && !Array.isArray(inputs[root]) ? inputs[root] : {};
  inputs[root][rest.join(".")] = value;
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
      const inputs = widgetValues(node, info);
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
