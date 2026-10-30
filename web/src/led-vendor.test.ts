import { afterEach, describe, expect, it, vi } from "vitest";
import { Matrix } from "./brand/led/matrix.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("supplied Matrix constructor rollback", () => {
  it.each(["intersection", "observe", "draw"])("disconnects partially initialized observers on %s failure", (failure) => {
    const resizeDisconnect = vi.fn(), intersectionDisconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      observe() { if (failure === "observe") throw Error("observe"); }
      disconnect = resizeDisconnect;
    });
    vi.stubGlobal("IntersectionObserver", class {
      constructor() { if (failure === "intersection") throw Error("intersection"); }
      observe() {}
      disconnect = intersectionDisconnect;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect() { throw Error("draw"); } } as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 240 } as DOMRect);
    expect(() => new Matrix(canvas)).toThrow(failure);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(intersectionDisconnect).toHaveBeenCalledTimes(failure === "draw" ? 1 : 0);
  });
});
