// @ts-check
/** @typedef {'ellipse'|'rectangle'|'rounded'|'diamond'} MatrixShape */
/** @typedef {{contentBrightness:number,contrast:number,invert:boolean}} Tone */
/** @param {number} value */
export function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

/** Content is composited onto black before this sRGB luminance/tone transform.
 * @param {number} red @param {number} green @param {number} blue @param {Tone} tone */
export function luminance(red, green, blue, tone) {
  const gray = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  const bright = (gray * tone.contentBrightness) / 100;
  const value = clamp(((bright - 0.5) * tone.contrast) / 100 + 0.5);
  return tone.invert ? 1 - value : value;
}

/** @param {number} x @param {number} y @param {MatrixShape} shape */
export function insideShape(x, y, shape) {
  if (shape === "rectangle") return true;
  if (shape === "diamond") return Math.abs(x) + Math.abs(y) <= 1;
  if (shape === "rounded")
    return (
      Math.hypot(
        Math.max(0, Math.abs(x) - 0.7),
        Math.max(0, Math.abs(y) - 0.7),
      ) <= 0.3
    );
  return Math.hypot(x, y) <= 1;
}

/** @type {Array<{x:number,y:number,weight:number}>} */
const neighbors = [];
for (let y = -2; y <= 2; y++)
  for (let x = -2; x <= 2; x++) {
    if (x !== 0 || y !== 0)
      neighbors.push({ x, y, weight: Math.exp(-(x * x + y * y) / 1.8) * 0.12 });
  }

/** One nonrecursive spill pass: only original bright emitters are donors.
 * @param {Float32Array} input @param {Uint8Array} mask
 * @param {number} columns @param {number} rows @param {number} amount @param {Float32Array} output */
export function spillLight(input, mask, columns, rows, amount, output) {
  output.set(input);
  if (amount === 0) return;
  for (let i = 0; i < input.length; i++) {
    if (!mask[i] || input[i] <= 0.6) continue;
    const energy = (((input[i] - 0.6) / 0.4) ** 2 * amount) / 100;
    const row = Math.floor(i / columns);
    const col = i % columns;
    for (const neighbor of neighbors) {
      const x = col + neighbor.x;
      const y = row + neighbor.y;
      if (x < 0 || x >= columns || y < 0 || y >= rows) continue;
      const index = y * columns + x;
      if (mask[index]) output[index] += energy * neighbor.weight;
    }
  }
  for (let i = 0; i < output.length; i++) output[i] = clamp(output[i]);
}
