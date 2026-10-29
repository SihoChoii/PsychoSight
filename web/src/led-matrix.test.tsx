import { vi } from "vitest";
import { Profiler, StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as rig from "./fixtures/led-renderer-stub";
import { ProgressView } from "./components/ProgressView";
import { uiPreviewJob } from "./fixtures/ui-previews";
import { fireEvent } from "@testing-library/react";
import { LedMatrix } from "./components/progress/LedMatrix";

vi.mock("./brand/led/matrix.js", () => import("./fixtures/led-renderer-stub"));
let queue: Map<number, FrameRequestCallback>;
let reduced: boolean;
let hidden: boolean;
let media: EventTarget;
let resolveFont: () => void;
let fontLoad: ReturnType<typeof vi.fn>;
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
const instance = () => rig.Matrix.instances[rig.Matrix.instances.length - 1];
function frame(time: number) { act(() => { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(fn => fn(time)); }); }
function visibility(value: boolean) { act(() => { instance().visible = value; instance().onVisibilityChange?.(); }); }

beforeEach(() => {
  rig.Matrix.instances = []; Object.assign(rig.faults, { init: false, draw: false, resize: false });
  queue = new Map(); reduced = false; hidden = false; media = new EventTarget(); let next = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { queue.set(++next, callback); return next; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => queue.delete(id)));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return reduced; }, addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media) })));
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  fontLoad = vi.fn(() => new Promise<void>(resolve => { resolveFont = resolve; }));
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: fontLoad, ready: Promise.resolve() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (originalFonts) Object.defineProperty(document, "fonts", originalFonts); else Reflect.deleteProperty(document, "fonts"); });

describe("LED lifecycle with renderer stub", () => {
  it("merges defaults, clears media, and redraws static factual progress without a clock or signal restart", async () => {
    const view = render(<LedMatrix signal="progress" progressPercent={30} />); const m = instance();
    expect(m.configure).toHaveBeenCalledWith({ brightness: 100, glow: 45, spill: 55, speed: 100, columns: 31, rows: 31, shape: "ellipse" });
    expect(m.setSource).toHaveBeenCalledWith(null); expect(m.setProgress).toHaveBeenLastCalledWith(30);
    expect(queue.size).toBe(0); const calls = m.draw.mock.calls.length;
    view.rerender(<LedMatrix signal="progress" progressPercent={30} />); expect(m.draw).toHaveBeenCalledTimes(calls);
    view.rerender(<LedMatrix signal="progress" progressPercent={40} />);
    expect(m.setSignal).toHaveBeenCalledTimes(1); expect(m.setProgress).toHaveBeenLastCalledWith(40); expect(queue.size).toBe(0);
    const beforeFont = m.draw.mock.calls.length; await act(async () => { resolveFont(); });
    expect(fontLoad).toHaveBeenCalledWith('16px "Geist Mono"', "0123456789"); expect(m.draw.mock.calls.length).toBeGreaterThan(beforeFont);
  });
  it.each([NaN, Infinity, -Infinity, undefined])("never forwards nonfinite progress %s", (value) => {
    render(<LedMatrix signal="progress" progressPercent={value} />); expect(instance().setProgress).not.toHaveBeenCalled(); expect(instance().setSignal).toHaveBeenCalledWith("orbit", false);
  });
  it("caps delta seconds and 30fps with no per-frame React commits", () => {
    const commits = vi.fn(); render(<Profiler id="led" onRender={commits}><LedMatrix signal="queued" /></Profiler>);
    const m = instance(); const before = commits.mock.calls.length; m.draw.mockClear();
    frame(0); frame(16); frame(32); expect(m.draw).not.toHaveBeenCalled(); frame(34); frame(50); frame(68); frame(1068);
    expect(m.draw.mock.calls).toEqual([[0.034, true], [0.034, true], [0.1, true]]); expect(commits).toHaveBeenCalledTimes(before);
  });
  it("pauses without resetting signals and resumes without accumulated time", () => {
    const view = render(<LedMatrix signal="orbit" />); const m = instance(); frame(0); frame(40);
    view.rerender(<LedMatrix signal="orbit" paused />); expect(queue.size).toBe(0); const calls = m.draw.mock.calls.length;
    frame(99999); expect(m.draw).toHaveBeenCalledTimes(calls);
    view.rerender(<LedMatrix signal="orbit" />); frame(100000); frame(100040);
    expect(m.draw).toHaveBeenLastCalledWith(0.04, true); expect(m.setSignal).toHaveBeenCalledTimes(1);
  });
  it("suspends hidden/offscreen work and invalidates on return", () => {
    render(<LedMatrix signal="queued" />); const m = instance(); frame(0); visibility(false); expect(queue.size).toBe(0);
    const calls = m.draw.mock.calls.length; m.render(0, false); expect(m.draw).toHaveBeenCalledTimes(calls);
    visibility(true); expect(queue.size).toBe(1);
    act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); }); expect(queue.size).toBe(0);
    m.render(0, false); expect(m.draw).toHaveBeenCalledTimes(calls + 1);
    act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); }); frame(10000); frame(10040);
    expect(m.draw).toHaveBeenLastCalledWith(0.04, true);
  });
  it.each(["success", "failure"] as const)("traces %s once, settles and releases its clock", (signal) => {
    render(<LedMatrix signal={signal} animateTerminal />); const m = instance();
    for (let time = 0; time <= 1700; time += 40) frame(time);
    expect(queue.size).toBe(0); expect(m.time).toBe(2); const calls = m.draw.mock.calls.length;
    frame(9999); expect(m.draw).toHaveBeenCalledTimes(calls); expect(m.setSignal).toHaveBeenCalledTimes(1);
  });
  it("settles terminal states immediately for reduced motion, including live changes and later resume", () => {
    const view = render(<LedMatrix signal="success" animateTerminal />); const m = instance(); frame(0); frame(40);
    act(() => { reduced = true; media.dispatchEvent(new Event("change")); }); expect(m.time).toBe(2); expect(queue.size).toBe(0);
    act(() => { reduced = false; media.dispatchEvent(new Event("change")); }); expect(queue.size).toBe(0);
    view.rerender(<LedMatrix signal="failure" animateTerminal={false} />); expect(m.setSignal).toHaveBeenLastCalledWith("failure", true); expect(queue.size).toBe(0);
  });
  it("starts reduced motion still and resumes an indeterminate signal on preference change", () => {
    reduced = true; render(<LedMatrix signal="orbit" />); expect(instance().setSignal).toHaveBeenCalledWith("orbit", true); expect(queue.size).toBe(0);
    act(() => { reduced = false; media.dispatchEvent(new Event("change")); }); expect(queue.size).toBe(1);
  });
  it.each(["init", "draw", "resize"] as const)("fails %s once to a decorative fallback and releases observers", (fault) => {
    if (fault === "init") rig.faults.init = true;
    const view = render(<LedMatrix signal="queued" />); const m = instance();
    if (fault !== "init") { rig.faults[fault] = true; act(() => { if (fault === "draw") m.render(0, false); else m.resizeDisplay(); }); }
    expect(view.container.querySelector("[data-led-fallback]" )).toBeInTheDocument(); expect(queue.size).toBe(0);
    if (m) { expect(m.resize.disconnect).toHaveBeenCalled(); expect(m.visibility.disconnect).toHaveBeenCalled(); }
    expect(view.container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  });
  it("cleans Strict Mode instances, observers, RAF, listeners and obsolete font promises", async () => {
    const view = render(<StrictMode><LedMatrix signal="queued" /></StrictMode>);
    expect(rig.Matrix.instances).toHaveLength(2); expect(rig.Matrix.instances[0].resize.disconnect).toHaveBeenCalledTimes(1);
    const m = instance(); view.unmount(); const calls = m.draw.mock.calls.length; expect(queue.size).toBe(0);
    await act(async () => { resolveFont(); }); act(() => { media.dispatchEvent(new Event("change")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(m.draw).toHaveBeenCalledTimes(calls); expect(m.visibility.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});


describe("job presentation with the real stage adapter", () => {
  it.each([["queued", "queued"], ["scoring", "progress"], ["experimental", "progress"],
    ["local-experimental", "progress"], ["scoring-unknown", "orbit"], ["scoring-zero", "progress"], ["unknown-stage", "orbit"], ["done", "success"], ["error", "failure"]])
    ("maps %s to %s without replacing real stages", (name, signal) => {
      render(<ProgressView job={uiPreviewJob(name)} reportHref="#/report/preview" onBack={() => {}} />);
      expect(instance().setSignal.mock.calls[0][0]).toBe(signal);
      expect(screen.getByRole("list", { name: "Analysis stages" }).children).toHaveLength(7);
      if (name === "done") expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", "#/report/preview");
      if (name === "error") expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      if (name === "scoring") expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "12 of 40 episodes.");
      if (name === "local-experimental") expect(screen.getAllByText("Not run")).toHaveLength(2);
    });
  it("preserves stale progress and GET-only retry without claiming job failure", () => {
    const retry = vi.fn(); render(<ProgressView job={uiPreviewJob("scoring")} error={{ kind: "transport", message: "Offline" }} onRetry={retry} onBack={() => {}} />);
    expect(instance().setSignal.mock.calls[0][0]).toBe("progress"); expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Last known: 12 of 40 episodes.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Analysis stopped")).not.toBeInTheDocument(); expect(queue.size).toBe(0);
  });
  it("omits the display for missing jobs and keeps a return action", () => {
    render(<ProgressView job={null} error={{ kind: "missing", message: "Gone" }} onBack={() => {}} />);
    expect(rig.Matrix.instances).toHaveLength(0); expect(screen.getByRole("button", { name: "Conversations" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
