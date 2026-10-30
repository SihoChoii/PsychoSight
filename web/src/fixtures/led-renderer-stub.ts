import { vi } from "vitest";
export const faults = { init: false, draw: false, resize: false };
export class Matrix {
  static instances: Matrix[] = [];
  visible = true;
  dirty = true;
  time = 0;
  onVisibilityChange: (() => void) | null = null;
  resize = { disconnect: vi.fn() };
  visibility = { disconnect: vi.fn() };
  configure = vi.fn();
  setSource = vi.fn();
  setSignal = vi.fn();
  setProgress = vi.fn();
  draw = vi.fn((_delta: number, _animate: boolean) => { if (faults.draw) throw Error("draw"); });
  render = this.draw;
  resizeDisplay = vi.fn(() => { if (faults.resize) throw Error("resize"); });
  constructor() { if (faults.init) throw Error("init"); Matrix.instances.push(this); }
}

export const DEFAULTS = { brightness: 100, glow: 45, spill: 55, speed: 100 };
