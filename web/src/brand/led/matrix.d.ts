/** Narrow projection of the supplied renderer used by the progress display. */
export type Signal = 'orbit' | 'queued' | 'progress' | 'success' | 'failure' | 'sleep';
export interface Settings {
  brightness: number; gap: number; glow: number; spill: number; boost: number; speed: number;
  columns: number; rows: number; shape: 'ellipse' | 'rectangle' | 'rounded' | 'diamond';
  contentBrightness: number; contrast: number; invert: boolean; fit: 'contain' | 'cover';
  zoom: number; panX: number; panY: number;
}
export const DEFAULTS: Readonly<Settings>;
export class Matrix {
  constructor(canvas: HTMLCanvasElement, signal?: Signal, phase?: number);
  settings: Settings;
  visible: boolean;
  dirty: boolean;
  /** Native elapsed signal time; setting 2 holds a terminal mark without replaying it. */
  time: number;
  onVisibilityChange: (() => void) | null;
  resize: ResizeObserver;
  visibility: IntersectionObserver;
  configure(settings: Settings): void;
  setSource(source: null): void;
  setSignal(signal: Signal, settled?: boolean): void;
  setProgress(percent: number): void;
  render(deltaSeconds: number, animate: boolean): void;
  resizeDisplay(): void;
}
