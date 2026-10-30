import { useCallback, useEffect, useRef } from 'react';

/** One observer per visual, CSS-only reveal; no animation-frame React updates. */
function observeReveal(element: HTMLElement | SVGElement, variant: 'ink' | 'rise') {
  const attribute = variant === 'ink' ? 'graphState' : 'contentState';
  const animation = variant === 'ink' ? 'graph-ink-reveal' : 'content-rise-reveal';
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let visible = false, destroyed = false, interacted = false;
  const state = (value: string) => { if (!destroyed && element.dataset[attribute] !== value) element.dataset[attribute] = value; };
  const finish = () => { interacted = true; state('complete'); };
  const changed = () => { if (motion?.matches) finish(); };
  const ended = (event: Event) => { if ((event as AnimationEvent).animationName === animation) finish(); };
  element.addEventListener('animationend', ended);
  element.addEventListener('pointerdown', finish, { capture: true });
  if (variant === 'ink') element.addEventListener('pointermove', finish, { capture: true });
  element.addEventListener('focusin', finish);
  element.addEventListener('keydown', finish, { capture: true });
  if (variant === 'ink') element.addEventListener('wheel', finish, { passive: true, capture: true });
  motion?.addEventListener('change', changed);
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) {
      if (visible) { interacted = false; state(motion?.matches ? 'complete' : 'waiting'); }
      visible = false;
    } else if (entry.intersectionRatio >= .15 && !visible) {
      visible = true;
      state(motion?.matches || interacted ? 'complete' : 'revealing');
    }
  }, { threshold: [0, .15] });
  state(observer && !motion?.matches ? 'waiting' : 'complete');
  observer?.observe(element);
  return () => {
    destroyed = true; observer?.disconnect(); motion?.removeEventListener('change', changed);
    element.removeEventListener('animationend', ended);
    element.removeEventListener('pointerdown', finish, true);
    element.removeEventListener('pointermove', finish, true);
    element.removeEventListener('focusin', finish);
    element.removeEventListener('keydown', finish, true);
    element.removeEventListener('wheel', finish, true);
  };
}
export function observeGraphReveal(element: HTMLElement | SVGElement) { return observeReveal(element, 'ink'); }
export function observeContentReveal(element: HTMLElement) { return observeReveal(element, 'rise'); }
function useRevealRef<T extends HTMLElement | SVGElement>(variant: 'ink' | 'rise') {
  const dispose = useRef<(() => void) | null>(null);
  useEffect(() => () => { dispose.current?.(); dispose.current = null; }, []);
  return useCallback((element: T | null) => {
    dispose.current?.(); dispose.current = element ? observeReveal(element, variant) : null;
  }, [variant]);
}

export function useGraphReveal<T extends HTMLElement | SVGElement>() { return useRevealRef<T>('ink'); }
export function useContentReveal<T extends HTMLElement>() { return useRevealRef<T>('rise'); }
