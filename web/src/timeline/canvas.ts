import { blockLevel, clamp, detailMix, fitCamera, lowerBound, nearestEpisode, panCamera, stageCamera, tickLabels, visibleEpisodes, visibleMessages, zoomCamera, type Camera, type Level, type Selection, type TimedMessage, type TimelineModel } from "./model";
export interface Viewport extends Camera {
    level: Level;
    unit: number;
    visibleEpisodeIds: string[];
}
interface Hit {
    x: number;
    y: number;
    w: number;
    h: number;
    selection: Selection;
}
interface Palette {
    background: string;
    foreground: string;
    secondary: string;
    line: string;
    iris: string;
    focus: string;
}
/** One canvas and one demand-driven clock. React receives semantic changes, never animation frames. */
export class TimelineCanvas {
    private ctx: CanvasRenderingContext2D | null;
    private width = 800;
    private height = 360;
    private dpr = 1;
    private camera: Camera;
    private target: Camera;
    private raf = 0;
    private previous = 0;
    private lastNotify = 0;
    private reduced = false;
    private destroyed = false;
    private visible = typeof IntersectionObserver === 'undefined';
    private entranceStarted: number | null = null;
    private entranceDone = false;
    private messages: TimedMessage[] = [];
    private messageReveal = 0;
    private hits: Hit[] = [];
    private hover: {
        x: number;
        y: number;
    } | null = null;
    private selected: Selection | null = null;
    private points = new Map<number, {
        x: number;
        y: number;
    }>();
    private drag: {
        x: number;
        y: number;
        camera: Camera;
        moved: boolean;
    } | null = null;
    private pinch: {
        distance: number;
        camera: Camera;
    } | null = null;
    private colors: Palette = { background: '#000', foreground: '#fff', secondary: '#a3a3a3', line: '#292929', iris: '#8f7cff', focus: '#b3a6ff' };
    private disposers: (() => void)[] = [];
    constructor(private canvas: HTMLCanvasElement, private model: TimelineModel, private onViewport: (view: Viewport, settled: boolean) => void, private onSelect: (selection: Selection | null) => void) {
        this.camera = { ...model.bounds };
        this.target = { ...model.bounds };
        canvas.dataset.entrance = 'waiting';
        this.ctx = typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d', { alpha: false });
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        this.reduced = motion?.matches ?? true;
        const motionChange = () => { this.reduced = motion?.matches ?? true; if (this.reduced) {
            this.finishEntrance(); this.camera = { ...this.target };
        } this.invalidate(); };
        motion?.addEventListener('change', motionChange);
        this.disposers.push(() => motion?.removeEventListener('change', motionChange));
        this.palette();
        const themes = new MutationObserver(() => { this.palette(); this.invalidate(); });
        themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        this.disposers.push(() => themes.disconnect());
        const resize = () => { const rect = canvas.getBoundingClientRect(); if (rect.width > 0) {
            this.width = rect.width;
            this.height = rect.height || 360;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(this.width * this.dpr);
            canvas.height = Math.round(this.height * this.dpr);
            this.invalidate();
        } };
        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(resize);
            observer.observe(canvas);
            this.disposers.push(() => observer.disconnect());
        }
        resize();
        if (typeof IntersectionObserver !== 'undefined') {
            const observer = new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; if (this.visible)
                this.invalidate();
            else
                this.stop(); });
            observer.observe(canvas);
            this.disposers.push(() => observer.disconnect());
        }
        const visibility = () => { if (document.hidden)
            this.stop();
        else {
            this.camera = { ...this.target };
            this.invalidate();
        } };
        document.addEventListener('visibilitychange', visibility);
        this.disposers.push(() => document.removeEventListener('visibilitychange', visibility));
        this.listen('dblclick', () => { this.select(null); this.stage('overview'); });
        this.listen('wheel', this.wheel, { passive: false });
        this.listen('pointerdown', this.down);
        this.listen('pointermove', this.move);
        this.listen('pointerup', this.up);
        this.listen('pointercancel', this.cancel);
        this.listen('pointerleave', () => { if (!this.drag) {
            this.hover = null;
            this.invalidate();
        } });
        this.listen('keydown', this.key);
        document.fonts?.ready.then(() => { if (!this.destroyed)
            this.invalidate(); });
        this.invalidate();
        this.notify(true);
    }
    private listen<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions) { this.canvas.addEventListener(type, handler as EventListener, options); this.disposers.push(() => this.canvas.removeEventListener(type, handler as EventListener, options)); }
    private palette() { const css = getComputedStyle(document.documentElement); for (const key of Object.keys(this.colors) as (keyof Palette)[])
        this.colors[key] = css.getPropertyValue(`--${key}`).trim() || this.colors[key]; }
    private stop() { if (this.raf)
        cancelAnimationFrame(this.raf); this.raf = 0; this.previous = 0; }
    destroy() { this.destroyed = true; this.stop(); for (const dispose of this.disposers)
        dispose(); this.messages = []; this.hits = []; }
    private invalidate = () => { if (!this.destroyed && this.visible && !document.hidden && !this.raf)
        this.raf = requestAnimationFrame(this.frame); };
    private frame = (now: number) => {
        this.raf = 0;
        if (this.destroyed)
            return;
        const dt = this.previous ? Math.min(50, now - this.previous) : 16;
        this.previous = now;
        if (!this.entranceDone) {
            if (this.entranceStarted === null) {
                this.entranceStarted = now;
                this.canvas.dataset.entrance = 'running';
            }
            if (this.reduced || now - this.entranceStarted >= 480) this.finishEntrance();
        }
        const distance = Math.abs(this.camera.start - this.target.start) + Math.abs(this.camera.end - this.target.end), span = this.target.end - this.target.start;
        const moving = !this.reduced && distance > Math.max(1, span * .00001);
        if (moving) {
            const a = 1 - Math.exp(-dt / 65);
            this.camera = { start: this.camera.start + (this.target.start - this.camera.start) * a, end: this.camera.end + (this.target.end - this.camera.end) * a };
        }
        else
            this.camera = { ...this.target };
        this.draw(now);
        if (!moving && this.entranceDone || now - this.lastNotify > 120) {
            this.notify(!moving);
            this.lastNotify = now;
        }
        if (!this.entranceDone || moving || !this.reduced && now - this.messageReveal < 180)
            this.invalidate();
        else
            this.previous = 0;
    };
    private notify(settled: boolean) { const mix = detailMix(this.camera, this.model), bins = blockLevel(this.model, this.camera, this.width); this.onViewport({ ...this.camera, level: mix.level, unit: this.unit(bins), visibleEpisodeIds: mix.level === 'overview' ? [] : visibleEpisodes(this.model, this.camera).map(e => e.episode.episode_id) }, settled); }
    private unit(bins: ReturnType<typeof blockLevel>) {
        const mid = this.height * .46;
        const rows = Math.max(1, Math.min(9, Math.floor((Math.min(mid - 28, this.height - 70 - mid) - 12) / 15)));
        return Math.max(1, Math.ceil((this.model.units.get(bins) ?? 1) * 9 / rows));
    }
    private finishEntrance() { if (this.entranceDone) return; this.entranceDone = true; this.canvas.dataset.entrance = 'complete'; }
    private setCamera(camera: Camera) { this.finishEntrance(); this.target = fitCamera(camera, this.model.bounds); if (this.reduced)
        this.camera = { ...this.target }; this.invalidate(); }
    zoom(factor: number, anchor = .5) { this.setCamera(zoomCamera(this.target, factor, anchor, this.model.bounds)); }
    pan(fraction: number) { this.setCamera(panCamera(this.target, (this.target.end - this.target.start) * fraction, this.model.bounds)); }
    stage(level: Level) { this.setCamera(stageCamera(level, this.target, this.model, this.selected)); }
    focusEpisode(id: string) { const item = this.model.episodes.find(e => e.episode.episode_id === id); if (item) {
        this.select({ type: 'episode', item });
        this.setCamera(stageCamera('messages', this.target, this.model, this.selected));
    } }
    setMessages(messages: TimedMessage[]) { this.messages = messages; this.messageReveal = performance.now(); this.invalidate(); }
    select(selection: Selection | null) { this.finishEntrance(); this.selected = selection; this.onSelect(selection); this.invalidate(); }
    private position(event: PointerEvent | WheelEvent) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
    private wheel = (event: WheelEvent) => {
        const point = this.position(event), mult = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
        let next: Camera;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey)
            next = panCamera(this.target, event.deltaX * mult / this.width * (this.target.end - this.target.start), this.model.bounds);
        else
            next = zoomCamera(this.target, Math.exp(clamp(event.deltaY * mult, -240, 240) * (event.ctrlKey ? .009 : .0035)), clamp((point.x - 24) / (this.width - 48), 0, 1), this.model.bounds);
        if (Math.abs(next.start - this.target.start) + Math.abs(next.end - this.target.end) < .01)
            return;
        event.preventDefault();
        this.hover = null;
        this.setCamera(next);
    };
    private down = (event: PointerEvent) => {
        if (event.button !== 0)
            return;
        this.finishEntrance();
        const p = this.position(event);
        this.canvas.focus({ preventScroll: true });
        this.canvas.setPointerCapture?.(event.pointerId);
        this.points.set(event.pointerId, p);
        this.drag = { ...p, camera: { ...this.target }, moved: false };
        if (this.points.size === 2) {
            const [a, b] = [...this.points.values()];
            this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), camera: { ...this.target } };
        }
    };
    private move = (event: PointerEvent) => {
        const p = this.position(event);
        if (this.points.has(event.pointerId))
            this.points.set(event.pointerId, p);
        if (this.pinch && this.points.size === 2) {
            const [a, b] = [...this.points.values()];
            this.setCamera(zoomCamera(this.pinch.camera, this.pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), (a.x + b.x) / 2 / this.width, this.model.bounds));
            if (this.drag)
                this.drag.moved = true;
        }
        else if (this.drag && this.points.has(event.pointerId)) {
            const dx = p.x - this.drag.x;
            if (Math.abs(dx) > 4)
                this.drag.moved = true;
            if (this.drag.moved)
                this.setCamera(panCamera(this.drag.camera, -dx / (this.width - 48) * (this.drag.camera.end - this.drag.camera.start), this.model.bounds));
        }
        else {
            this.hover = p;
            this.invalidate();
        }
    };
    private hit(p: {
        x: number;
        y: number;
    }) { return this.hits.filter(h => p.x >= h.x - 5 && p.x <= h.x + h.w + 5 && p.y >= h.y - 8 && p.y <= h.y + h.h + 8).sort((a, b) => Math.abs(a.x + a.w / 2 - p.x) - Math.abs(b.x + b.w / 2 - p.x))[0]; }
    private up = (event: PointerEvent) => { if (this.drag && !this.drag.moved && !this.pinch) {
        const hit = this.hit(this.position(event));
        if (hit)
            this.select(hit.selection);
    } this.cancel(event); };
    private cancel = (event: PointerEvent) => { this.points.delete(event.pointerId); this.drag = null; this.pinch = null; if (this.canvas.hasPointerCapture?.(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId); };
    private key = (event: KeyboardEvent) => {
        if (['+', '=', '-', '_', 'ArrowLeft', 'ArrowRight', 'Home', 'Escape', 'Enter'].includes(event.key))
            event.preventDefault();
        if (event.key === '+' || event.key === '=')
            this.zoom(.5);
        else if (event.key === '-' || event.key === '_')
            this.zoom(2);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            this.pan(event.key === 'ArrowLeft' ? -.3 : .3);
        else if (event.key === 'Home') {
            this.select(null);
            this.stage('overview');
        }
        else if (event.key === 'Escape')
            this.select(null);
        else if (event.key === 'Enter') {
            const ep = nearestEpisode(this.model, (this.camera.start + this.camera.end) / 2);
            if (ep)
                this.focusEpisode(ep.episode.episode_id);
        }
    };
    private draw(now: number) {
        const ctx = this.ctx;
        if (!ctx)
            return;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.width, this.height);
        const { start, end } = this.camera, span = end - start, left = 24, right = this.width - 24, mid = this.height * .46, x = (time: number) => left + (time - start) / span * (right - left), mix = detailMix(this.camera, this.model);
        this.hits = [];
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.colors.line;
        ctx.beginPath();
        ctx.moveTo(left, mid + .5);
        ctx.lineTo(right, mid + .5);
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, 20, right - left, this.height - 70);
        ctx.clip();
        if (mix.overview > .001) {
            const all = blockLevel(this.model, this.camera, this.width), unit = this.unit(all), from = Math.max(0, lowerBound(all, start, b => b.end) - 1), to = lowerBound(all, end, b => b.start);
            ctx.globalAlpha = mix.overview;
            for (const bin of all.slice(from, to)) {
                const bx = x((bin.start + bin.end) / 2), cell = clamp((x(bin.end) - x(bin.start)) * .6, 3, 11), pitch = cell + 4;
                for (const side of ['me', 'other'] as const) {
                    const count = bin[side] / unit, sign = side === 'me' ? -1 : 1;
                    for (let k = 0; k < Math.ceil(count); k++) {
                        const cy = mid + sign * (12 + k * pitch + cell / 2), fy = cy * (1 - mix.episodes * .3) + (mid + sign * 38) * mix.episodes * .3;
                        const progress = this.entranceDone ? 1 : clamp((now - (this.entranceStarted ?? now) - clamp((bx - left) / (right - left), 0, 1) * 120 - k * 12) / 220, 0, 1);
                        const reveal = 1 - (1 - progress) ** 3, entranceY = mid + (fy - mid) * reveal;
                        ctx.globalAlpha = mix.overview * reveal;
                        ctx.fillStyle = side === 'me' ? this.colors.foreground : this.colors.background;
                        ctx.strokeStyle = side === 'me' ? this.colors.foreground : this.colors.iris;
                        ctx.lineWidth = 1.5;
                        const h = cell;
                        ctx.fillRect(bx - cell / 2, entranceY - h / 2, cell, h);
                        if (side === 'other')
                            ctx.strokeRect(bx - cell / 2 + .5, entranceY - h / 2 + .5, Math.max(.5, cell - 1), Math.max(.5, h - 1));
                    }
                }
                if (mix.level === 'overview')
                    this.hits.push({ x: bx - Math.max(cell, 8) / 2, y: mid - 150, w: Math.max(cell, 8), h: 300, selection: { type: 'block', bin } });
            }
        }
        const episodes = mix.overview < 1 ? visibleEpisodes(this.model, this.camera) : [];
        if (mix.episodes > .001 || mix.messages > .001) {
            const pending = mix.messages > .001 && visibleMessages(this.messages, this.camera).length === 0;
            ctx.globalAlpha = Math.max(mix.episodes, pending ? .28 : 0);
            let lastLabel = -100;
            for (const item of episodes) {
                const a = x(item.start), b = x(item.end), w = Math.max(3, b - a);
                for (const side of ['me', 'other'] as const) {
                    if (!item.episode.messages[side])
                        continue;
                    const y = mid + (side === 'me' ? -48 : 32);
                    ctx.fillStyle = side === 'me' ? this.colors.foreground : this.colors.background;
                    ctx.strokeStyle = side === 'me' ? this.colors.foreground : this.colors.iris;
                    ctx.lineWidth = 1.5;
                    if (side === 'me')
                        ctx.fillRect(a, y, w, 14);
                    else
                        ctx.strokeRect(a, y, w, 14);
                }
                if (mix.level === 'episodes' || pending)
                    this.hits.push({ x: a, y: mid - 60, w: Math.max(10, w), h: 120, selection: { type: 'episode', item } });
                if (a > lastLabel + 90) {
                    ctx.fillStyle = this.colors.secondary;
                    ctx.font = '12px "Geist Mono", monospace';
                    ctx.fillText(`${item.episode.messages.me + item.episode.messages.other} messages`, a, mid + 90);
                    lastLabel = a;
                }
            }
        }
        if (mix.messages > .001 && this.messages.length) {
            ctx.globalAlpha = mix.messages * (this.reduced ? 1 : clamp((now - this.messageReveal) / 180, 0, 1));
            const rows = visibleMessages(this.messages, this.camera), occupied = new Map<string, number>(), turns = new Map<string, {
                start: number;
                end: number;
                side: 'me' | 'other';
            }>();
            for (const item of rows) {
                const m = item.message, bx = x(item.time), key = `${m.speaker}-${Math.floor(bx / 5)}`, stack = occupied.get(key) ?? 0;
                occupied.set(key, stack + 1);
                // Colliding timestamps remain at the same x, stacking in their speaker lane.
                const cy = mid + (m.speaker === 'me' ? -1 : 1) * (38 + Math.min(stack, 7) * 10), size = clamp((right - left) / Math.max(1, rows.length) * .35, 3, 9);
                ctx.fillStyle = m.speaker === 'me' ? this.colors.foreground : this.colors.background;
                ctx.strokeStyle = m.speaker === 'me' ? this.colors.foreground : this.colors.iris;
                ctx.lineWidth = 1.5;
                if (stack < 8) {
                    if (m.speaker === 'me')
                        ctx.fillRect(bx - size / 2, cy - size / 2, size, size);
                    else
                        ctx.strokeRect(bx - size / 2, cy - size / 2, size, size);
                }
                if (mix.level === 'messages')
                    this.hits.push({ x: bx - size / 2, y: cy - size / 2, w: size, h: size, selection: { type: 'message', item } });
                const turn = turns.get(m.turn_id);
                if (turn)
                    turn.end = bx;
                else
                    turns.set(m.turn_id, { start: bx, end: bx, side: m.speaker });
            }
            ctx.strokeStyle = this.colors.line;
            ctx.lineWidth = 1;
            for (const turn of turns.values()) {
                if (turn.end - turn.start < 16)
                    continue;
                const ty = mid + (turn.side === 'me' ? -1 : 1) * 64;
                ctx.beginPath();
                ctx.moveTo(turn.start, ty + (turn.side === 'me' ? 4 : -4));
                ctx.lineTo(turn.start, ty);
                ctx.lineTo(turn.end, ty);
                ctx.lineTo(turn.end, ty + (turn.side === 'me' ? 4 : -4));
                ctx.stroke();
            }
            // A count makes coincident dense marks explicit instead of pretending they are one message.
            ctx.fillStyle = this.colors.secondary;
            ctx.font = '11px "Geist Mono", monospace';
            for (const [key, count] of occupied)
                if (count > 8) {
                    const [side, px] = key.split('-');
                    ctx.fillText(String(count), Number(px) * 5, mid + (side === 'me' ? -1 : 1) * 125);
                }
        }
        ctx.globalAlpha = 1;
        const selectedTime = this.selected?.type === 'message' ? this.selected.item.time : this.selected?.type === 'episode' ? (this.selected.item.start + this.selected.item.end) / 2 : this.selected?.type === 'block' ? (this.selected.bin.start + this.selected.bin.end) / 2 : null;
        if (selectedTime !== null && selectedTime >= start && selectedTime <= end) {
            ctx.strokeStyle = this.colors.focus;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(x(selectedTime), 22);
            ctx.lineTo(x(selectedTime), this.height - 66);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (this.hover && !this.drag) {
            const hit = this.hit(this.hover);
            this.canvas.style.cursor = hit ? 'pointer' : 'grab';
            if (hit) {
                ctx.strokeStyle = this.colors.foreground;
                ctx.strokeRect(hit.x - 4, hit.y - 4, hit.w + 8, hit.h + 8);
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        ctx.fillStyle = this.colors.secondary;
        ctx.font = '12px "Geist Mono", monospace';
        ctx.textAlign = 'center';
        for (const tick of tickLabels(this.camera, this.width)) {
            const px = x(tick.time);
            if (px < left + 22 || px > right - 22)
                continue;
            ctx.fillText(tick.label, px, this.height - 20);
            ctx.strokeStyle = this.colors.line;
            ctx.beginPath();
            ctx.moveTo(px, this.height - 53);
            ctx.lineTo(px, this.height - 47);
            ctx.stroke();
        }
        ctx.textAlign = 'left';
    }
}
