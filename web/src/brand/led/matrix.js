// @ts-check
import {
  clamp,
  insideShape,
  luminance,
  spillLight,
} from "./light-processing.js";
/** @typedef {'bulb'|'grow'|'orbit'|'notification'|'sleep'|'success'|'failure'|'progress'|'upload'|'download'|'queued'} Signal */
/** @typedef {import('./light-processing.js').MatrixShape} MatrixShape */
/** @typedef {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement|OffscreenCanvas|ImageBitmap} Source */
/** @typedef {{brightness:number,gap:number,glow:number,spill:number,boost:number,speed:number,columns:number,rows:number,shape:MatrixShape,contentBrightness:number,contrast:number,invert:boolean,fit:'contain'|'cover',zoom:number,panX:number,panY:number}} Settings */

/** @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({
  brightness: 100,
  gap: 22,
  glow: 45,
  spill: 55,
  boost: 150,
  speed: 100,
  columns: 41,
  rows: 41,
  shape: "ellipse",
  contentBrightness: 100,
  contrast: 100,
  invert: false,
  fit: "contain",
  zoom: 100,
  panX: 0,
  panY: 0,
});
export const SIGNALS = Object.freeze([
  "bulb",
  "grow",
  "orbit",
  "notification",
  "sleep",
  "success",
  "failure",
  "progress",
  "upload",
  "download",
  "queued",
]);
const LEVELS = Array.from({ length: 256 }, (_, i) => `rgb(${i},${i},${i})`);

/** @param {HTMLCanvasElement} canvas @param {boolean} readOften */
function context(canvas, readOften = false) {
  const ctx = canvas.getContext("2d", { willReadFrequently: readOften });
  if (!ctx) throw new Error("This exploration needs Canvas 2D support.");
  return ctx;
}

/** Continuous canvas graphics are rendered before LED sampling.
 * @param {CanvasRenderingContext2D} ctx @param {Signal} signal @param {number} t @param {number} progress */
function drawGraphic(ctx, signal, t, progress) {
  ctx.save();
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
  const scale = Math.min(ctx.canvas.width, ctx.canvas.height) / 2;
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 0.065;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (signal === "bulb" || signal === "grow") {
    for (const [i, width] of [1, 0.68, 0.34].entries()) {
      ctx.globalAlpha =
        signal === "grow"
          ? 0.1 + 0.9 * (Math.sin(t * 1.6 - i * 1.8) * 0.5 + 0.5)
          : 0.88 + 0.12 * Math.sin(t * 1.3 - i * 0.4);
      ctx.beginPath();
      ctx.moveTo(0, -0.66);
      ctx.bezierCurveTo(
        0.02 * width,
        -0.33,
        0.64 * width,
        -0.13,
        0.65 * width,
        0.22,
      );
      ctx.bezierCurveTo(0.68 * width, 0.55, 0.34 * width, 0.73, 0, 0.73);
      ctx.bezierCurveTo(
        -0.34 * width,
        0.73,
        -0.68 * width,
        0.55,
        -0.65 * width,
        0.22,
      );
      ctx.bezierCurveTo(-0.64 * width, -0.13, -0.02 * width, -0.33, 0, -0.66);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(-0.03, -0.66);
    ctx.bezierCurveTo(-0.08, -0.76, 0.08, -0.79, 0.08, -0.88);
    ctx.stroke();
  } else if (signal === "orbit") {
    for (let i = 0; i < 64; i++) {
      const angle = t * 1.1 - (i * Math.PI * 2) / 64;
      ctx.globalAlpha = 0.025 + 0.975 * Math.exp(-i / 9);
      ctx.beginPath();
      ctx.arc(0, 0, 0.57, angle - 0.11, angle);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, 0.045, 0, Math.PI * 2);
    ctx.fill();
  } else if (signal === "notification") {
    ctx.globalAlpha = 0.5 + 0.5 * (Math.sin(t * 1.7) * 0.5 + 0.5);
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x * 0.3, y * 0.54);
        ctx.lineTo(x * 0.54, y * 0.54);
        ctx.lineTo(x * 0.54, y * 0.3);
        ctx.stroke();
      }
    ctx.beginPath();
    ctx.moveTo(0, -0.065);
    ctx.lineTo(0.065, 0);
    ctx.lineTo(0, 0.065);
    ctx.lineTo(-0.065, 0);
    ctx.closePath();
    ctx.fill();
  } else if (signal === "success") {
    // Trace once, release a quiet ring of light, then keep the result readable.
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.43, 0.02);
    ctx.lineTo(-0.12, 0.33);
    ctx.lineTo(0.48, -0.34);
    revealStroke(ctx, clamp(t / 0.85), 1.35);
    const release = clamp((t - 0.65) / 0.8);
    if (release > 0 && release < 1) {
      ctx.globalAlpha = Math.sin(release * Math.PI) * 0.3;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.arc(0, 0, 0.56 + release * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (signal === "failure") {
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-0.36, -0.36);
    ctx.lineTo(0.36, 0.36);
    revealStroke(ctx, clamp(t / 0.4), 1.02);
    ctx.beginPath();
    ctx.moveTo(0.36, -0.36);
    ctx.lineTo(-0.36, 0.36);
    revealStroke(ctx, clamp((t - 0.3) / 0.4), 1.02);
    ctx.globalAlpha = 0.14 + 0.35 * Math.sin(clamp(t / 1.5) * Math.PI);
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(0, 0, 0.7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (signal === "progress") {
    const amount = clamp(progress / 100);
    ctx.lineWidth = 0.08;
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, 0.65, 0, Math.PI * 2);
    ctx.stroke();
    if (amount > 0) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 0.65, -Math.PI / 2, -Math.PI / 2 + amount * Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // A fixed center and alphabetic baseline prevent optical drift. Monospaced
    // advances keep equal-length readings aligned; density preserves the glyphs.
    ctx.font = '0.4px "Geist Mono", monospace';
    ctx.fontKerning = "none";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(Math.floor(progress + 1e-9)), 0, 0.14);
  } else if (signal === "upload" || signal === "download") {
    const direction = signal === "upload" ? -1 : 1;
    ctx.lineWidth = 0.075;
    ctx.beginPath();
    ctx.moveTo(0, -direction * 0.32);
    ctx.lineTo(0, direction * 0.4);
    ctx.moveTo(-0.23, direction * 0.16);
    ctx.lineTo(0, direction * 0.4);
    ctx.lineTo(0.23, direction * 0.16);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(-0.42, direction * 0.5);
    ctx.lineTo(-0.42, direction * 0.64);
    ctx.lineTo(0.42, direction * 0.64);
    ctx.lineTo(0.42, direction * 0.5);
    ctx.stroke();
    // Moving light packets feed the arrow; physical matrix cells stay fixed.
    for (let i = 0; i < 3; i++) {
      const travel = (t * 0.75 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(travel * Math.PI) ** 2;
      ctx.fillRect(
        -0.055,
        direction * (-0.75 + travel * 0.48) - 0.055,
        0.11,
        0.11,
      );
    }
  } else if (signal === "queued") {
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha =
        0.15 + 0.85 * Math.max(0, Math.cos(t * 2.4 - i * 1.4)) ** 4;
      ctx.fillRect((i - 1) * 0.36 - 0.075, -0.075, 0.15, 0.15);
    }
  } else {
    ctx.globalAlpha = 0.16 + 0.5 * (Math.sin(t * 0.75) * 0.5 + 0.5);
    ctx.beginPath();
    ctx.moveTo(-0.3, 0);
    ctx.lineTo(0.3, 0);
    ctx.stroke();
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {number} amount @param {number} length */
function revealStroke(ctx, amount, length) {
  if (amount <= 0) return;
  ctx.setLineDash([length, length]);
  ctx.lineDashOffset = length * (1 - amount);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** @param {Source} source */
function sourceSize(source) {
  if (source instanceof HTMLVideoElement)
    return [source.videoWidth, source.videoHeight];
  if (source instanceof HTMLImageElement)
    return [source.naturalWidth, source.naturalHeight];
  return [source.width, source.height];
}

export class Matrix {
  /** @param {HTMLCanvasElement} canvas @param {Signal} signal @param {number} phase */
  constructor(canvas, signal = "bulb", phase = 0) {
    this.canvas = canvas;
    this.ctx = context(canvas);
    this.base = document.createElement("canvas");
    this.baseCtx = context(this.base);
    this.emission = document.createElement("canvas");
    this.emissionCtx = context(this.emission);
    this.content = document.createElement("canvas");
    this.contentCtx = context(this.content);
    this.sample = document.createElement("canvas");
    this.sampleCtx = context(this.sample, true);
    /** @type {HTMLCanvasElement|null} */ this.preview = null;
    /** @type {Source|null} */ this.source = null;
    /** @type {null|(()=>void)} */ this.onVisibilityChange = null;
    /** @type {Settings} */ this.settings = { ...DEFAULTS };
    this.signal = signal;
    this.phase = phase;
    this.time = 0;
    this.progress = 50;
    this.power = true;
    this.visible = false;
    this.dirty = true;
    this.width = 0;
    this.height = 0;
    this.pitch = 0;
    this.levels = new Float32Array(0);
    this.lit = new Float32Array(0);
    this.mask = new Uint8Array(0);
    this.lastVideoTime = -1;
    this.rebuildGrid();
    this.resize = new ResizeObserver(() => this.resizeDisplay());
    // Roll back partial initialization if observation or the first draw fails.
    try {
      this.resize.observe(canvas);
      this.visibility = new IntersectionObserver((entries) => {
        this.visible = entries[0].isIntersecting;
        if (this.visible) {
          this.dirty = true;
          this.render(0, false);
        }
        this.onVisibilityChange?.();
      });
      this.visibility.observe(canvas);
      this.resizeDisplay();
    } catch (error) {
      this.resize.disconnect();
      this.visibility?.disconnect();
      throw error;
    }
  }

  rebuildGrid() {
    const { columns, rows, shape } = this.settings;
    this.levels = new Float32Array(columns * rows);
    this.lit = new Float32Array(columns * rows);
    this.mask = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        this.mask[row * columns + col] = Number(
          insideShape(
            ((col + 0.5) / columns) * 2 - 1,
            ((row + 0.5) / rows) * 2 - 1,
            shape,
          ),
        );
      }
    this.sample.width = columns;
    this.sample.height = rows;
    this.content.width = columns * 4;
    this.content.height = rows * 4;
    const fraction = (columns / Math.max(columns, rows)) * 100;
    this.canvas.style.width = `${fraction}%`;
    this.canvas.style.aspectRatio = `${columns} / ${rows}`;
    if (this.preview) {
      this.preview.style.width = `${fraction}%`;
      this.preview.style.aspectRatio = `${columns} / ${rows}`;
    }
    this.dirty = true;
  }

  resizeDisplay() {
    const cssWidth = this.canvas.getBoundingClientRect().width;
    if (!cssWidth) return;
    const { columns, rows } = this.settings;
    const width = Math.max(
      columns,
      Math.round(
        Math.min(640, cssWidth) * Math.min(2, window.devicePixelRatio || 1),
      ),
    );
    const height = Math.round((width / columns) * rows);
    this.pitch = width / columns;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    for (const canvas of [this.canvas, this.base, this.emission]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.drawBase();
    this.render(0, false);
  }

  drawBase() {
    const ctx = this.baseCtx;
    const side = this.pitch * (1 - this.settings.gap / 100);
    const inset = (this.pitch - side) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.width, this.height);
    for (let i = 0; i < this.mask.length; i++) {
      if (!this.mask[i]) continue;
      const x = (i % this.settings.columns) * this.pitch + inset;
      const y = Math.floor(i / this.settings.columns) * this.pitch + inset;
      ctx.fillStyle = "#101010";
      ctx.fillRect(x, y, side, side);
      ctx.fillStyle = "#171717";
      ctx.fillRect(x, y, side, Math.max(0.5, this.pitch * 0.04));
    }
    this.dirty = true;
  }

  /** Origin-clean media or rendered canvas. Owner controls playback and URLs.
   * @param {Source|null} source */
  setSource(source) {
    this.source = source;
    this.lastVideoTime = -1;
    this.levels.fill(0);
    this.dirty = true;
  }
  /** @param {Signal} signal @param {boolean} settled */
  setSignal(signal, settled = false) {
    this.signal = signal;
    this.time = settled ? 2 : 0;
    this.levels.fill(0);
    this.dirty = true;
  }
  /** @param {number} value */
  setProgress(value) {
    if (!Number.isFinite(value))
      throw new RangeError("Progress must be finite.");
    this.progress = clamp(value / 100) * 100;
    this.dirty = true;
  }
  /** @param {Settings} values */
  configure(values) {
    if (
      ![values.columns, values.rows].every(
        (value) => Number.isInteger(value) && value >= 8 && value <= 128,
      )
    )
      throw new RangeError(
        "Matrix dimensions must be integers between 8 and 128.",
      );
    const changed =
      values.columns !== this.settings.columns ||
      values.rows !== this.settings.rows ||
      values.shape !== this.settings.shape;
    this.settings = { ...values };
    if (changed) {
      this.rebuildGrid();
      this.resizeDisplay();
    }
    this.drawBase();
  }

  drawContent() {
    const ctx = this.contentCtx;
    const { width, height } = this.content;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (this.source) {
      const [w, h] = sourceSize(this.source);
      if (!w || !h) return;
      const fit =
        this.settings.fit === "cover"
          ? Math.max(width / w, height / h)
          : Math.min(width / w, height / h);
      const scale = (fit * this.settings.zoom) / 100;
      const x =
        (width - w * scale) / 2 + ((this.settings.panX / 100) * width) / 2;
      const y =
        (height - h * scale) / 2 + ((this.settings.panY / 100) * height) / 2;
      ctx.drawImage(this.source, x, y, w * scale, h * scale);
    } else {
      ctx.save();
      ctx.translate(
        width / 2 + ((this.settings.panX / 100) * width) / 2,
        height / 2 + ((this.settings.panY / 100) * height) / 2,
      );
      ctx.scale(this.settings.zoom / 100, this.settings.zoom / 100);
      ctx.translate(-width / 2, -height / 2);
      drawGraphic(ctx, this.signal, this.time + this.phase, this.progress);
      ctx.restore();
    }
    if (this.preview) {
      if (this.preview.width !== width || this.preview.height !== height) {
        this.preview.width = width;
        this.preview.height = height;
      }
      const previewCtx = context(this.preview);
      previewCtx.filter = `grayscale(1) brightness(${this.settings.contentBrightness}%) contrast(${this.settings.contrast}%) invert(${Number(this.settings.invert)})`;
      previewCtx.drawImage(this.content, 0, 0);
      previewCtx.filter = "none";
    }
  }

  /** @param {number} elapsed @param {boolean} animate */
  render(elapsed, animate) {
    if (!this.width) return;
    const video = this.source instanceof HTMLVideoElement ? this.source : null;
    const videoTime = video ? video.currentTime : -1;
    const still =
      this.source instanceof HTMLImageElement ||
      this.source instanceof ImageBitmap;
    if (
      !this.dirty &&
      ((!animate && !video) ||
        still ||
        (video && videoTime === this.lastVideoTime) ||
        !this.power)
    )
      return;
    if (video && video.readyState < 2) return;
    if (animate && !this.source)
      this.time += (elapsed * this.settings.speed) / 100;
    this.drawContent();
    const { columns, rows } = this.settings;
    this.sampleCtx.drawImage(this.content, 0, 0, columns, rows);
    const pixels = this.sampleCtx.getImageData(0, 0, columns, rows).data;
    const response =
      !animate || this.dirty || still ? 1 : 1 - Math.exp(-elapsed / 0.045);
    for (let i = 0; i < this.levels.length; i++) {
      const value = luminance(
        pixels[i * 4],
        pixels[i * 4 + 1],
        pixels[i * 4 + 2],
        this.settings,
      );
      const target =
        this.power && this.mask[i]
          ? clamp(
              (((value * this.settings.brightness) / 100) *
                this.settings.boost) /
                100,
            )
          : 0;
      this.levels[i] += (target - this.levels[i]) * response;
    }
    spillLight(
      this.levels,
      this.mask,
      columns,
      rows,
      this.settings.spill,
      this.lit,
    );
    const light = this.emissionCtx;
    const side = this.pitch * (1 - this.settings.gap / 100);
    const inset = (this.pitch - side) / 2;
    light.clearRect(0, 0, this.width, this.height);
    for (let i = 0; i < this.lit.length; i++) {
      if (!this.mask[i] || this.lit[i] < 0.002) continue;
      light.fillStyle = LEVELS[Math.round(16 + 239 * Math.sqrt(this.lit[i]))];
      light.fillRect(
        (i % columns) * this.pitch + inset,
        Math.floor(i / columns) * this.pitch + inset,
        side,
        side,
      );
    }
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    if (this.power && this.settings.glow > 0) {
      const halo = this.settings.glow / 100;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = halo * 0.5;
      ctx.filter = `blur(${this.pitch * 1.1}px)`;
      ctx.drawImage(this.emission, 0, 0);
      ctx.globalAlpha = halo * 0.7;
      ctx.filter = `blur(${this.pitch * 0.25}px)`;
      ctx.drawImage(this.emission, 0, 0);
      ctx.restore();
    }
    ctx.drawImage(this.emission, 0, 0);
    this.lastVideoTime = videoTime;
    this.dirty = false;
  }
}
