import { useEffect, useRef } from "react";

export function DeleteDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      root
        ? [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        : [];
    focusable()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previously?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-consequence"
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="delete-title">Delete report</h2>
        <p id="delete-consequence">This removes the saved report and its evidence quotes from this computer.</p>
        <div className="actions">
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Deleting report" : "Delete report"}
          </button>
        </div>
      </div>
    </div>
  );
}
