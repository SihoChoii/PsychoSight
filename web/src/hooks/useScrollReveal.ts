import { useEffect, useRef, useState } from "react";

/** Replay on returning to view, with a fully offscreen reset to avoid edge flicker. */
export function useScrollReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      if (!entry.isIntersecting) setRevealed(false);
      else if (entry.intersectionRatio >= 0.3) setRevealed(true);
    }, { threshold: [0, 0.3] });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, revealed };
}
