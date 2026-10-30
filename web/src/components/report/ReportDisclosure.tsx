import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const DISMISS = 'psychosight:dismiss-report-layers';
export function dismissReportLayers(except?: Element | null) { window.dispatchEvent(new CustomEvent(DISMISS, { detail: except })); }
let locks = 0, savedOverflow = '';
function lockScroll() {
  if (locks++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  return () => { if (--locks === 0) document.body.style.overflow = savedOverflow; };
}

/** Information floats next to its control; working tools use a bounded, modal side panel. */
export function ReportDisclosure({ label, title = label, triggerText = label, descriptionId, kind = 'panel', wide = false, className = '', children, open: controlled, onOpenChange }: {
  label: string; title?: string; kind?: 'info' | 'panel'; wide?: boolean; className?: string;
  children: ReactNode | (() => ReactNode); open?: boolean; onOpenChange?: (open: boolean) => void; triggerText?: string; descriptionId?: string;
}) {
  const [localOpen, setLocalOpen] = useState(false), [mounted, setMounted] = useState(false), [closing, setClosing] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const open = controlled ?? localOpen;
  const id = useId(), heading = useId(), trigger = useRef<HTMLButtonElement>(null), content = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null), timer = useRef<number | undefined>(undefined), hoverTimer = useRef<number | undefined>(undefined);
  const pinned = useRef(false), previous = useRef<HTMLElement | null>(null), restore = useRef(true);
  const suppressFocus = useRef(false);
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const changeRef = useRef(setOpen); changeRef.current = setOpen;
  function close(immediate = false, focus = true) {
    pinned.current = false; restore.current = focus;
    suppressFocus.current = true;
    clearTimeout(hoverTimer.current); clearTimeout(timer.current);
    if (immediate) { dialog.current?.close(); setMounted(false); setClosing(false); }
    changeRef.current(false);
    if (kind === 'info' && focus) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (mounted && kind === 'info' && pinned.current) closeButton.current?.focus({ preventScroll: true });
  }, [mounted, kind]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      restore.current = true; setClosing(false); setMounted(true);
    } else if (mounted) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      setClosing(true);
      timer.current = window.setTimeout(() => { dialog.current?.close(); setMounted(false); setClosing(false); }, reduced ? 0 : 160);
    }
    return () => clearTimeout(timer.current);
  }, [open]); // mounted deliberately follows open, including its exit animation.
  useEffect(() => {
    const dismiss = (event: Event) => { if ((event as CustomEvent).detail !== dialog.current || !dialog.current) close(true, false); };
    window.addEventListener(DISMISS, dismiss);
    return () => { window.removeEventListener(DISMISS, dismiss); clearTimeout(hoverTimer.current); };
  }, []);
  useEffect(() => {
    if (!mounted || kind !== 'panel') return;
    const node = dialog.current;
    node?.showModal(); closeButton.current?.focus({ preventScroll: true });
    const unlock = lockScroll();
    return () => { node?.close(); unlock(); if (restore.current && previous.current?.isConnected) previous.current.focus({ preventScroll: true }); };
  }, [mounted, kind]);
  useLayoutEffect(() => {
    if (!mounted || kind !== 'info') return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(), box = content.current?.getBoundingClientRect();
      if (!rect || !box) return;
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - box.width - 16));
      const top = rect.bottom + 8 + box.height <= window.innerHeight - 16 ? rect.bottom + 8 : Math.max(16, rect.top - box.height - 8);
      setPosition({ left, top });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, { capture: true, passive: true });
    const outside = (event: PointerEvent) => { if (!content.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(true, false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [mounted, kind]);
  const enter = () => { clearTimeout(hoverTimer.current); if (!pinned.current) hoverTimer.current = window.setTimeout(() => changeRef.current(true), 180); };
  const leave = () => { clearTimeout(hoverTimer.current); if (!pinned.current) hoverTimer.current = window.setTimeout(() => changeRef.current(false), 180); };
  const body = mounted ? <><header className="report-layer-heading"><h2 id={heading}>{title}</h2><button ref={closeButton} type="button" aria-label={`Close ${title}`} onClick={() => close()}><span aria-hidden="true">×</span></button></header><div className="report-layer-body">{typeof children === 'function' ? children() : children}</div></> : null;
  return <div className={`report-disclosure ${className}`}>
    <button ref={trigger} type="button" className={kind === 'info' ? 'report-info-button' : 'report-tool-button'} aria-label={label} aria-describedby={descriptionId} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onKeyDown={event => { if (kind === 'info' && open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onPointerEnter={event => { if (kind === 'info' && event.pointerType !== 'touch') enter(); }} onPointerLeave={() => { if (kind === 'info') leave(); }}
      onFocus={() => { if (suppressFocus.current) { suppressFocus.current = false; return; } if (kind === 'info' && trigger.current?.matches(':focus-visible')) enter(); }} onBlur={event => { suppressFocus.current = false; if (kind === 'info' && !content.current?.contains(event.relatedTarget)) leave(); }}
      onClick={() => { clearTimeout(hoverTimer.current); if (open && pinned.current) close(); else { pinned.current = true; changeRef.current(true); if (kind === 'info' && mounted) closeButton.current?.focus({ preventScroll: true }); } }}>
      {kind === 'info' ? <span aria-hidden="true">i</span> : <>{triggerText}<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 12 12 4M5 4h7v7"/></svg></>}
    </button>
    {mounted && createPortal(kind === 'info' ? <div ref={content} id={id} role="dialog" aria-labelledby={heading} className={`report-layer report-popover ${className}`} data-closing={closing} style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} onPointerEnter={() => clearTimeout(hoverTimer.current)} onPointerLeave={leave} onFocus={() => clearTimeout(hoverTimer.current)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) leave(); }}>{body}</div>
      : <dialog ref={dialog} id={id} aria-labelledby={heading} className={`report-layer report-sheet ${wide ? 'report-sheet-wide' : ''} ${className}`} data-closing={closing}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
        }}>{body}</dialog>, kind === 'info' ? trigger.current?.closest('dialog') ?? document.body : document.body)}
  </div>;
}
