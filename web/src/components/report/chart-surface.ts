import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import type { ChartGeometry } from "../../charts/geometry";

export function usePlotWidth() {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const update = (next: number) => { if (next > 0) setWidth(Math.round(next)); };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) update(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { plot, width };
}

export function hitWeek(event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>, geometry: ChartGeometry) {
  const rect = event.currentTarget.getBoundingClientRect();
  return geometry.hitTest((event.clientX - rect.left) * geometry.width / rect.width);
}
