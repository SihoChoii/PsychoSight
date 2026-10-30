import { matrixHit, matrixLayout, type HighlightCategory, type SelectionCategory, type SelectionModel } from './model';

type Reveal = 'waiting' | 'revealing' | 'complete';
const categories: SelectionCategory[] = ['top_signal', 'random', 'unclassified', 'unselected'];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const x = clamp(n); return 1 - (1 - x) ** 3; };

/** Draw visible rows only. Replay on viewport return; no perpetual animation or per-frame React updates. */
export class SelectionMatrix {
  private ctx: CanvasRenderingContext2D | null;
  private width = 700;
  private height = 224;
  private dpr = 1;
  private raf = 0;
  private previous = 0;
  private visible = false;
  private destroyed = false;
  private reduced = true;
  private started: number | null = null;
  private replayPending = false;
  private reveal: Reveal = 'waiting';
  private highlight: HighlightCategory = null;
  private weights = { top_signal: 1, random: 1, unclassified: 1, unselected: .38 };
  private hover: number | null = null;
  private selected: number | null = null;
  private focused = false;
  private cursor = 0;
  private down: { x: number; y: number; scroll: number } | null = null;
  private palette = { background: '#000', foreground: '#fff', control: '#777', iris: '#8f7cff', focus: '#b3a6ff' };
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private scroller: HTMLDivElement, space: HTMLDivElement,
    private model: SelectionModel, private inspect: (index: number | null, pin: boolean, keyboard?: boolean) => void,
    private phase: (phase: Reveal) => void) {
    this.ctx = typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d', { alpha: false });
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reduced = motion?.matches ?? true;
    const motionChange = () => { this.reduced = motion?.matches ?? true; if (this.reduced) this.finish(); this.invalidate(); };
    motion?.addEventListener('change', motionChange);
    this.disposers.push(() => motion?.removeEventListener('change', motionChange));
    this.colors();
    const themes = new MutationObserver(() => { this.colors(); this.invalidate(); });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.disposers.push(() => themes.disconnect());
    const resize = () => {
      this.width = scroller.clientWidth || 700;
      const layout = matrixLayout(this.width, model.items.length);
      this.height = Math.min(352, layout.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      scroller.style.height = `${this.height}px`;
      scroller.dataset.overflow = String(layout.height > this.height);
      space.style.height = `${layout.height}px`;
      canvas.style.height = `${this.height}px`;
      canvas.width = Math.round(this.width * this.dpr); canvas.height = Math.round(this.height * this.dpr);
      this.invalidate();
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(resize); observer.observe(scroller);
      this.disposers.push(() => observer.disconnect());
    }
    resize();
    const enter = (visible: boolean) => {
      if (this.destroyed) return;
      if (!visible) {
        this.stop();
        if (this.visible) {
          this.started = null;
          this.replayPending = true;
          this.hover = null;
          this.down = null;
          this.inspect(null, false);
          this.setPhase('waiting');
        }
        this.visible = false;
        return;
      }
      this.visible = visible;
      if (visible) {
        if (this.started === null) {
          this.started = performance.now();
          if (this.replayPending || this.reveal !== 'complete') this.setPhase(this.reduced ? 'complete' : 'revealing');
          this.replayPending = false;
        }
        this.invalidate();
      }
    };
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(([entry]) => {
        // Re-arm only after a full exit; wait for a useful area on return to avoid edge flicker.
        if (!entry.isIntersecting) enter(false);
        else if (entry.intersectionRatio >= .15) enter(true);
      }, { threshold: [0, .15] });
      observer.observe(canvas); this.disposers.push(() => observer.disconnect());
    } else enter(true);
    const visibility = () => { if (document.hidden) this.stop(); else this.invalidate(); };
    document.addEventListener('visibilitychange', visibility);
    this.disposers.push(() => document.removeEventListener('visibilitychange', visibility));
    const scroll = () => { this.hover = null; if (!this.focused) this.inspect(null, false); this.invalidate(); };
    scroller.addEventListener('scroll', scroll, { passive: true });
    this.disposers.push(() => scroller.removeEventListener('scroll', scroll));
    this.listen('pointermove', event => {
      if (event.pointerType === 'touch') return;
      const index = this.hit(event.clientX, event.clientY);
      if (index !== this.hover) { this.finish(); this.hover = index; this.inspect(index, false); this.invalidate(); }
    });
    this.listen('pointerleave', () => { this.hover = null; this.inspect(null, false); this.invalidate(); });
    this.listen('pointerdown', event => { if (event.button === 0) this.down = { x: event.clientX, y: event.clientY, scroll: scroller.scrollTop }; });
    this.listen('pointerup', event => {
      if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) < 8 && Math.abs(scroller.scrollTop - this.down.scroll) < 8) {
        const index = this.hit(event.clientX, event.clientY);
        if (index !== null) { this.cursor = index; this.finish(); this.inspect(index, true); canvas.focus({ preventScroll: true }); }
      }
      this.down = null;
    });
    this.listen('pointercancel', () => { this.down = null; });
    this.listen('focus', () => { this.focused = true; this.cursor = this.selected ?? this.cursor; this.inspect(this.cursor, false, true); this.invalidate(); });
    this.listen('blur', () => { this.focused = false; this.inspect(null, false); this.invalidate(); });
    this.listen('keydown', this.key);
  }
  private listen<K extends keyof HTMLElementEventMap>(name: K, listener: (event: HTMLElementEventMap[K]) => void) {
    this.canvas.addEventListener(name, listener); this.disposers.push(() => this.canvas.removeEventListener(name, listener));
  }
  private colors() {
    const css = getComputedStyle(document.documentElement);
    this.palette = { background: css.getPropertyValue('--background').trim() || '#000', foreground: css.getPropertyValue('--foreground').trim() || '#fff',
      control: css.getPropertyValue('--control-line').trim() || '#777', iris: css.getPropertyValue('--iris').trim() || '#8f7cff', focus: css.getPropertyValue('--focus').trim() || '#b3a6ff' };
  }
  private setPhase(value: Reveal) { if (value !== this.reveal) { this.reveal = value; this.phase(value); } }
  private finish() {
    if (!this.visible && this.replayPending) return;
    this.setPhase('complete');
  }
  setHighlight(value: HighlightCategory) { if (value === this.highlight) return; this.highlight = value; if (value !== null) this.finish(); this.invalidate(); }
  setSelected(index: number | null) { this.selected = index; if (index !== null) this.finish(); this.invalidate(); }
  private hit(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return matrixHit(clientX - rect.left, clientY - rect.top + this.scroller.scrollTop, this.width, this.model.items.length);
  }
  private key = (event: KeyboardEvent) => {
    const { columns, pitch } = matrixLayout(this.width, this.model.items.length);
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, PageUp: -columns * 6, PageDown: columns * 6 };
    if (event.key in delta || ['Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault(); else return;
    this.finish();
    if (event.key === 'Escape') { this.inspect(null, true); return; }
    if (event.key === 'Enter' || event.key === ' ') { this.inspect(this.cursor, true); return; }
    this.cursor = Math.max(0, Math.min(this.model.items.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? this.model.items.length - 1 : this.cursor + delta[event.key]));
    const top = Math.floor(this.cursor / columns) * pitch;
    if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
    else if (top + pitch + 16 > this.scroller.scrollTop + this.height) this.scroller.scrollTop = top + pitch + 16 - this.height;
    this.inspect(this.cursor, false, true); this.invalidate();
  };
  private invalidate = () => { if (!this.raf && !this.destroyed && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame); };
  private stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.previous = 0; }
  destroy() { this.destroyed = true; this.stop(); this.disposers.forEach(dispose => dispose()); }
  private frame = (now: number) => {
    this.raf = 0;
    const dt = this.previous ? Math.min(50, now - this.previous) : 16; this.previous = now;
    let moving = false;
    for (const category of categories) {
      const target = this.highlight === 'all' ? 1 : this.highlight ? (this.highlight === category ? 1 : .12) : category === 'unselected' ? .38 : 1;
      const delta = target - this.weights[category];
      this.weights[category] = this.reduced || Math.abs(delta) < .005 ? target : this.weights[category] + delta * (1 - Math.exp(-dt / 55));
      if (this.weights[category] !== target) moving = true;
    }
    const elapsed = this.reduced || this.reveal === 'complete' ? 2500 : now - (this.started ?? now);
    if (elapsed >= 800) this.setPhase('complete');
    this.draw(elapsed);
    if (moving || this.reveal === 'revealing') this.invalidate(); else this.previous = 0;
  };
  private draw(elapsed: number) {
    const ctx = this.ctx; if (!ctx) return;
    const { columns, pitch, size } = matrixLayout(this.width, this.model.items.length), scroll = this.scroller.scrollTop;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = this.palette.background; ctx.fillRect(0, 0, this.width, this.height);
    const first = Math.max(0, Math.floor(scroll / pitch) * columns), last = Math.min(this.model.items.length, Math.ceil((scroll + this.height) / pitch) * columns);
    for (let i = first; i < last; i++) {
      const item = this.model.items[i], x = 4 + (i % columns) * pitch + (pitch - size) / 2, y = 8 + Math.floor(i / columns) * pitch + (pitch - size) / 2 - scroll;
      const arrive = ease((elapsed - i / Math.max(1, this.model.items.length - 1) * 120) / 150);
      const selectedReveal = item.category === 'top_signal' ? ease((elapsed - 200 - item.rank / Math.max(1, this.model.counts.top_signal) * 120) / 130)
        : item.category === 'random' ? ease((elapsed - 400 - item.rank / Math.max(1, this.model.counts.random) * 120) / 150) : item.category === 'unclassified' ? ease((elapsed - 200) / 130) : 0;
      const focus = i === this.hover || i === this.selected || this.focused && i === this.cursor;
      ctx.globalAlpha = arrive * (focus ? 1 : this.weights[item.category]);
      ctx.lineWidth = 1; ctx.strokeStyle = this.palette.control; ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
      if (item.category !== 'unselected') {
        ctx.globalAlpha *= selectedReveal;
        if (item.category === 'top_signal') { ctx.fillStyle = this.palette.foreground; ctx.fillRect(x, y, size, size); }
        else { ctx.lineWidth = 2; ctx.strokeStyle = item.category === 'random' ? this.palette.iris : this.palette.foreground; ctx.strokeRect(x + 1, y + 1, size - 2, size - 2); }
      }
      if (focus) {
        ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = this.palette.focus;
        ctx.strokeRect(x - 4 + .5, y - 4 + .5, size + 7, size + 7);
      }
    }
    ctx.globalAlpha = 1;
  }
}
