import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportDisclosure, dismissReportLayers } from './components/report/ReportDisclosure';

describe('quiet report disclosures', () => {
  it('mounts working data on demand, restores focus and unlocks page scrolling after close', async () => {
    const data=vi.fn(()=> <p>Exact original data</p>);
    render(<ReportDisclosure label="Browse data">{data}</ReportDisclosure>);
    const trigger=screen.getByRole('button',{name:'Browse data'}); trigger.focus();
    expect(data).not.toHaveBeenCalled(); fireEvent.click(trigger);
    const panel=screen.getByRole('dialog',{name:'Browse data'});
    expect(panel).toHaveTextContent('Exact original data');
    expect(within(panel).getByRole('button',{name:'Close Browse data'})).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent(panel,new Event('cancel',{cancelable:true}));
    await waitFor(()=>expect(panel).not.toBeInTheDocument());
    await waitFor(()=>{expect(trigger).toHaveFocus(); expect(document.body.style.overflow).not.toBe('hidden');});
  });
  it('supports hover information and keeps a clicked explanation open until dismissed', async () => {
    render(<ReportDisclosure kind="info" label="About the measure"><p>What this measures</p></ReportDisclosure>);
    const trigger=screen.getByRole('button',{name:'About the measure'});
    fireEvent.pointerEnter(trigger,{pointerType:'mouse'});
    await screen.findByRole('dialog',{name:'About the measure'});
    fireEvent.click(trigger); fireEvent.pointerLeave(trigger);
    await new Promise(done=>setTimeout(done,200));
    expect(screen.getByRole('dialog')).toHaveTextContent('What this measures');
    fireEvent.pointerDown(document.body);
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded','false');
  });
  it('closes only the active nested panel on Escape and keeps the parent scroll lock', async () => {
    render(<ReportDisclosure label="Weekly tools"><ReportDisclosure label="Exact table"><p>Rows</p></ReportDisclosure></ReportDisclosure>);
    fireEvent.click(screen.getByRole('button',{name:'Weekly tools'}));
    const parent=screen.getByRole('dialog',{name:'Weekly tools'}), childTrigger=within(parent).getByRole('button',{name:'Exact table'});
    childTrigger.focus(); fireEvent.click(childTrigger);
    const child=screen.getByRole('dialog',{name:'Exact table'}); fireEvent(child,new Event('cancel',{cancelable:true}));
    await waitFor(()=>expect(child).not.toBeInTheDocument());
    expect(parent).toBeInTheDocument(); expect(childTrigger).toHaveFocus(); expect(document.body.style.overflow).toBe('hidden');
    fireEvent(parent,new Event('cancel',{cancelable:true})); await waitFor(()=>expect(parent).not.toBeInTheDocument());
    expect(document.body.style.overflow).not.toBe('hidden');
  });
  it('dismisses layers for report navigation without returning focus to the old trigger', async () => {
    render(<><h2 id="target" tabIndex={-1}>Original episode</h2><ReportDisclosure label="Evidence"><button onClick={()=>{dismissReportLayers(); document.getElementById('target')!.focus();}}>Open original episode</button></ReportDisclosure></>);
    fireEvent.click(screen.getByRole('button',{name:'Evidence'}));
    fireEvent.click(screen.getByRole('button',{name:'Open original episode'}));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('heading',{name:'Original episode'})).toHaveFocus();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
