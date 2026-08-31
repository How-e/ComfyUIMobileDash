export function encodeUserdataPath(path) {
  // ComfyUI decodes the route and then explicitly unquotes its `file` value.
  // Protect literal percent signs so filenames such as "%A2.json" survive
  // both decoding passes while normal separators still reach the route safely.
  return encodeURIComponent(String(path).replaceAll("%", "%25"));
}
