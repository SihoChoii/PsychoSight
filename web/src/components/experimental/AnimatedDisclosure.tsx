import type { ReactNode } from "react";

/** An intrinsic-height transition that keeps closed content out of keyboard and screen-reader navigation. */
export function AnimatedDisclosure({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div id={id} className="exp-disclosure" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="exp-disclosure-inner">{children}</div>
    </div>
  );
}
