function greatestCommonDivisor(a, b) {
  let left = Math.abs(Math.round(a));
  let right = Math.abs(Math.round(b));
  while (right) [left, right] = [right, left % right];
  return left;
}

export function formatImageDimensions(width, height) {
  const safeWidth = Math.round(Number(width));
  const safeHeight = Math.round(Number(height));
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0 || safeHeight <= 0) return "";
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  return `${safeWidth} x ${safeHeight} · ${safeWidth / divisor}:${safeHeight / divisor}`;
}
