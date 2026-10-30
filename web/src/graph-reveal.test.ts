import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeContentReveal, observeGraphReveal } from './components/report/graph-reveal';

afterEach(()=>vi.unstubAllGlobals());
function graph(reduced=false, content=false) {
 let notify!: IntersectionObserverCallback;
 const disconnect=vi.fn(), remove=vi.fn();
 const motion={matches:reduced,addEventListener:vi.fn(),removeEventListener:remove};
 vi.stubGlobal('matchMedia',()=>motion);
 vi.stubGlobal('IntersectionObserver',class { constructor(callback:IntersectionObserverCallback){notify=callback;} observe(){} disconnect=disconnect; });
 const node=document.createElement('div'),dispose=content ? observeContentReveal(node) : observeGraphReveal(node);
 return {node,dispose,motion,disconnect,remove,enter:(ratio:number)=>notify([{isIntersecting:ratio>0,intersectionRatio:ratio} as IntersectionObserverEntry],{} as IntersectionObserver)};
}
describe('graph reveal lifecycle',()=>{
 it('reveals at a meaningful viewport entry, re-arms only after full exit, and yields to inspection',()=>{
  const {node,enter,dispose}=graph();
  expect(node.dataset.graphState).toBe('waiting'); enter(.05);expect(node.dataset.graphState).toBe('waiting');
  enter(.3);expect(node.dataset.graphState).toBe('revealing');
  node.dispatchEvent(new Event('pointerdown'));expect(node.dataset.graphState).toBe('complete');
  enter(.1);enter(.6);expect(node.dataset.graphState).toBe('complete');
  enter(0);expect(node.dataset.graphState).toBe('waiting');enter(.5);expect(node.dataset.graphState).toBe('revealing');dispose();
 });
 it('does not overwrite early keyboard interaction when the observer delivers its first entry',()=>{
  const {node,enter,dispose}=graph();node.dispatchEvent(new Event('focusin'));enter(.5);expect(node.dataset.graphState).toBe('complete');dispose();
 });
 it('shows reduced-motion graphs immediately and removes subscriptions on unmount',()=>{
  const {node,enter,dispose,motion,disconnect,remove}=graph(true);enter(.8);expect(node.dataset.graphState).toBe('complete');enter(0);expect(node.dataset.graphState).toBe('complete');
  motion.matches=false;enter(.8);expect(node.dataset.graphState).toBe('revealing');dispose();expect(disconnect).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledOnce();
  node.dispatchEvent(new Event('pointerdown'));expect(node.dataset.graphState).toBe('revealing');
 });
 it('lets scored content finish its upward reveal during scrolling and ignores nested graph animation events',()=>{
  const {node,enter,dispose}=graph(false,true);enter(.5);expect(node.dataset.contentState).toBe('revealing');
  node.dispatchEvent(new Event('wheel'));expect(node.dataset.contentState).toBe('revealing');
  const graphEnd=new Event('animationend');Object.defineProperty(graphEnd,'animationName',{value:'graph-ink-reveal'});
  node.dispatchEvent(graphEnd);expect(node.dataset.contentState).toBe('revealing');
  const contentEnd=new Event('animationend');Object.defineProperty(contentEnd,'animationName',{value:'content-rise-reveal'});
  node.dispatchEvent(contentEnd);expect(node.dataset.contentState).toBe('complete');
  enter(0);enter(.5);node.dispatchEvent(new Event('focusin'));expect(node.dataset.contentState).toBe('complete');dispose();
 });
});
