import { useEffect, useRef, useState } from "react";
import { DEFAULTS, Matrix, type Signal } from "../../brand/led/matrix.js";

interface Props {
  signal: Signal;
  progressPercent?: number | null;
  /** Resets interpolation when a new job or measured stage begins. */
  progressKey?: string;
  paused?: boolean;
  animateTerminal?: boolean;
}
type Controller = { update: (props: Props) => void };
const FRAME_MS = 1000 / 30;
const TERMINAL_SECONDS = 1.6;
const PROGRESS_SECONDS = 0.38;
const terminal = (signal: Signal) => signal === "success" || signal === "failure";

/** The renderer and its entire clock stay outside React's rendering loop. */
export function LedMatrix(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<Controller | null>(null);
  const initial = useRef(props);
  const [failed, setFailed] = useState(false);
  const unavailable = useRef(false);

  useEffect(() => {
    if (!canvas.current || unavailable.current) return;
    let matrix: Matrix | undefined;
    let disposed = false;
    let failedInstance = false;
    let raf: number | undefined;
    let previousTime: number | null = null;
    let elapsed = 0;
    let signal: Signal | null = null;
    let percent: number | null = null;
    let displayed = 0;
    let from = 0;
    let transitionElapsed = PROGRESS_SECONDS;
    let progressKey: string | undefined;
    let options = initial.current;
    let media: MediaQueryList | undefined;
    const motionAllowed = () => !options.paused && !media?.matches;
    const visible = () => !document.hidden && matrix?.visible;
    const transitioning = () => options.signal === "progress" && transitionElapsed < PROGRESS_SECONDS;
    const moving = () => motionAllowed() && (transitioning() || options.signal === "orbit" || options.signal === "queued"
      || (terminal(options.signal) && options.animateTerminal && elapsed < TERMINAL_SECONDS));
    function stop() {
      if (raf !== undefined) cancelAnimationFrame(raf);
      raf = undefined;
      previousTime = null;
    }
    function release() {
      stop();
      if (matrix) {
        matrix.onVisibilityChange = null;
        matrix.resize.disconnect();
        matrix.visibility.disconnect();
      }
    }
    function fail() {
      if (disposed || failedInstance) return;
      failedInstance = true;
      unavailable.current = true;
      release();
      controller.current = null;
      document.removeEventListener("visibilitychange", reconcile);
      media?.removeEventListener("change", reconcile);
      setFailed(true);
    }
    function invalidate() {
      if (!matrix || disposed || failedInstance) return;
      matrix.dirty = true;
      if (visible()) matrix.render(0, false);
    }
    function reconcile() {
      stop();
      if (!matrix || disposed || failedInstance) return;
      if (terminal(options.signal) && (!motionAllowed() || !options.animateTerminal)) {
        // Advance to the documented settled time without restarting setSignal.
        matrix.time = 2;
        elapsed = TERMINAL_SECONDS;
      }
      if (transitioning() && (!motionAllowed() || !visible())) settleProgress();
      invalidate();
      if (!failedInstance && visible() && moving()) raf = requestAnimationFrame(frame);
    }
    function frame(now: number) {
      raf = undefined;
      if (!matrix || disposed || failedInstance || !visible() || !moving()) { stop(); return; }
      if (previousTime === null) previousTime = now;
      const interval = now - previousTime;
      if (interval >= FRAME_MS) {
        const delta = Math.min(0.1, interval / 1000);
        previousTime = now;
        elapsed += delta;
        if (transitioning() && percent !== null) {
          transitionElapsed = Math.min(PROGRESS_SECONDS, transitionElapsed + delta);
          const t = transitionElapsed / PROGRESS_SECONDS;
          displayed = from + (percent - from) * (1 - (1 - t) ** 3);
          // Snap at the end; never drift past the latest measured value.
          if (transitionElapsed === PROGRESS_SECONDS) displayed = percent;
          matrix.setProgress(displayed);
          matrix.render(0, false);
        } else matrix.render(delta, true);
        if (terminal(options.signal) && elapsed >= TERMINAL_SECONDS) {
          matrix.time = 2;
          invalidate();
        }
      }
      if (!failedInstance && moving()) raf = requestAnimationFrame(frame);
    }
    function settleProgress() {
      transitionElapsed = PROGRESS_SECONDS;
      if (matrix && percent !== null) {
        displayed = percent;
        matrix.setProgress(displayed);
      }
    }
    function update(next: Props) {
      const finite = typeof next.progressPercent === "number" && Number.isFinite(next.progressPercent)
        ? Math.max(0, Math.min(100, next.progressPercent)) : null;
      const previousOptions = options;
      options = next.signal === "progress" && finite === null ? { ...next, signal: "orbit" } : next;
      if (!matrix || failedInstance || disposed) return;
      try {
        const changedSignal = signal !== options.signal;
        const changedStage = progressKey !== next.progressKey;
        const changedPercent = finite !== percent;
        const changedMotion = previousOptions.paused !== next.paused || previousOptions.animateTerminal !== next.animateTerminal;
        if (!changedSignal && !changedStage && !changedPercent && !changedMotion) return;
        if (changedSignal) {
          signal = options.signal;
          elapsed = 0;
          matrix.setSignal(signal, !motionAllowed() || (terminal(signal) && !next.animateTerminal));
        }
        progressKey = next.progressKey;
        if (finite !== null && (changedPercent || changedStage || changedSignal)) {
          const interpolate = !changedSignal && !changedStage && percent !== null
            && finite > displayed && motionAllowed() && visible();
          percent = finite;
          if (interpolate) { from = displayed; transitionElapsed = 0; }
          else settleProgress();
        } else if (finite === null) {
          percent = null;
          transitionElapsed = PROGRESS_SECONDS;
        }
        reconcile();
      } catch { fail(); }
    }
    try {
      media = window.matchMedia("(prefers-reduced-motion: reduce)");
      matrix = new Matrix(canvas.current, "sleep");
      // Native resize/intersection callbacks also go through the failure boundary.
      const render = matrix.render.bind(matrix);
      matrix.render = (delta, animate) => {
        if (disposed || failedInstance || !visible()) return;
        try { render(delta, animate); } catch { fail(); }
      };
      const resize = matrix.resizeDisplay.bind(matrix);
      matrix.resizeDisplay = () => {
        if (disposed || failedInstance) return;
        try { resize(); } catch { fail(); }
      };
      matrix.configure({ ...DEFAULTS, columns: 81, rows: 81, shape: "ellipse", glow: 20, spill: 25 });
      matrix.setSource(null);
      matrix.onVisibilityChange = reconcile;
      controller.current = { update };
      update(initial.current);
      document.addEventListener("visibilitychange", reconcile);
      media.addEventListener("change", reconcile);
      // Canvas text does not participate in font-display swapping automatically.
      if (document.fonts) {
        void document.fonts.load('16px "Geist Mono"', "0123456789")
          .then(() => document.fonts.ready).then(invalidate, invalidate);
      }
    } catch { fail(); }
    return () => {
      disposed = true;
      controller.current = null;
      release();
      document.removeEventListener("visibilitychange", reconcile);
      media?.removeEventListener("change", reconcile);
    };
  }, []);

  useEffect(() => {
    controller.current?.update(props);
  }, [props.signal, props.progressPercent, props.progressKey, props.paused, props.animateTerminal]);

  return <div className="led-display" data-led-fallback={failed || undefined}>
    <canvas ref={canvas} aria-hidden="true" hidden={failed} />
    {failed ? <span className="led-fallback" aria-hidden="true">{props.signal === "success" ? "✓" : props.signal === "failure" ? "×" : "· · ·"}</span> : null}
  </div>;
}
