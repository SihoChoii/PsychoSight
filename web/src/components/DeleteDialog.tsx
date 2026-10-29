import { useEffect, useRef } from "react";

export function DeleteDialog({ open, busy, error = null, onCancel, onConfirm }: {
  open: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    // The top layer makes the rest of the document inert, including to assistive technology.
    dialog.showModal();
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (open && busy) {
      closeRef.current?.focus();
    }
  }, [open, busy]);

  if (!open) return null;
  return (
    <dialog className="dialog" ref={ref} aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-consequence"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // WebKit can tab to the document viewport at a native dialog boundary.
        // These are the only interactive elements; skip the pending disabled action.
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right
          || event.clientY < box.top || event.clientY > box.bottom)) onCancel();
      }}>
      <h2 id="delete-title">Delete report</h2>
      <p id="delete-consequence">This removes the saved report and its evidence quotes from this computer.</p>
      {busy ? <p className="recovery-status" role="status">Deleting report. Deletion continues if you close this dialog.</p> : null}
      {error ? <p className="recovery-status field-error" role="alert">{error} You can try again or close this dialog.</p> : null}
      <div className="actions">
        <button ref={closeRef} type="button" className="button button-secondary" onClick={onCancel}>
          {busy ? "Close" : "Cancel"}
        </button>
        <button type="button" className="button" disabled={busy} onClick={onConfirm}>
          {busy ? "Deleting report" : error ? "Try again" : "Delete report"}
        </button>
      </div>
    </dialog>
  );
}
