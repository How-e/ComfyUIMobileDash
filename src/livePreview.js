const BINARY_EVENT = {
  previewImage: 1,
  previewImageWithMetadata: 4,
};

function readUint32(view, offset) {
  if (view.byteLength < offset + 4) return null;
  return view.getUint32(offset, false);
}

function imageMime(type) {
  if (type === 1) return "image/jpeg";
  if (type === 2) return "image/png";
  return "";
}

const KJ_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);

export function parseKjPreview(data) {
  if (!data || typeof data.image !== "string" || !data.image) return null;
  const mime = KJ_MEDIA_TYPES.has(data.mime) ? data.mime : "image/jpeg";
  try {
    const decoded = atob(data.image);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return {
      blob: new Blob([bytes], { type: mime }),
      metadata: {
        node_id: data.node_id,
        step: data.step,
        total: data.total,
        width: data.w,
        height: data.h,
      },
    };
  } catch {
    return null;
  }
}

export function parsePreviewFrame(value) {
  if (!(value instanceof ArrayBuffer) || value.byteLength < 8) return null;
  const view = new DataView(value);
  const eventType = readUint32(view, 0);

  if (eventType === BINARY_EVENT.previewImage) {
    const mime = imageMime(readUint32(view, 4));
    if (!mime || value.byteLength === 8) return null;
    return { blob: new Blob([value.slice(8)], { type: mime }), metadata: {} };
  }

  if (eventType !== BINARY_EVENT.previewImageWithMetadata) return null;
  const metadataLength = readUint32(view, 4);
  const imageOffset = 8 + metadataLength;
  if (metadataLength === null || imageOffset >= value.byteLength) return null;

  try {
    const metadata = JSON.parse(new TextDecoder().decode(value.slice(8, imageOffset)));
    const mime = metadata.image_type === "image/png" ? "image/png" : "image/jpeg";
    return { blob: new Blob([value.slice(imageOffset)], { type: mime }), metadata };
  } catch {
    return null;
  }
}
