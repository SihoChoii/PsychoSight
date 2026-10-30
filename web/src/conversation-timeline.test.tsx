import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationTimeline } from './components/report/ConversationTimeline';
import { uiPreviewReport } from './fixtures/ui-previews';
import { getClient } from './api';
import type { MessagePage } from './types';

vi.mock('./api', async original => ({...await original<typeof import('./api')>(),getClient:vi.fn()}));
afterEach(()=>vi.clearAllMocks());
const report=uiPreviewReport('ui-single-week')!;
function mount(getEpisodeMessages=vi.fn().mockResolvedValue({messages:[],total:0,next_offset:null,offset:0,episode_id:'one'})){
 vi.mocked(getClient).mockResolvedValue({getEpisodeMessages} as unknown as Awaited<ReturnType<typeof getClient>>);
 const result=render(<ConversationTimeline report={report} onWeek={vi.fn()} onEpisode={vi.fn()}/>);
 return {...result,getEpisodeMessages,canvas:screen.getByRole('img',{name:'Interactive conversation timeline'})};
}
describe('conversation timeline data lifecycle',()=>{
 it('starts with the block overview and no visible stage or zoom controls, without loading messages',async()=>{
  const {canvas,getEpisodeMessages,container}=mount();
  expect(container.querySelector('.conversation-timeline')).toHaveAttribute('data-level','overview');
  expect(screen.queryByRole('button',{name:'Episodes'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Zoom in'})).toBeNull();
  fireEvent.keyDown(canvas,{key:'+'});
  await waitFor(()=>expect(container.querySelector('.conversation-timeline')?.getAttribute('data-start')).not.toBeNull());
  expect(getEpisodeMessages).not.toHaveBeenCalled();
 });
 it('loads original message pages only after drilling in and exposes exact text for inspection',async()=>{
  const getter=vi.fn(async(_job:string,id:string):Promise<MessagePage>=>({episode_id:id,total:1,offset:0,next_offset:null,messages:[{id:'exact-message',timestamp:report.episodes!.find(e=>e.episode_id===id)!.start,speaker:'other',text:'Exact original message — punctuation intact.',episode_id:id,turn_id:'turn'}]}));
  const {canvas,container}=mount(getter);
  fireEvent.keyDown(canvas,{key:'Enter'});
  await waitFor(()=>expect(getter).toHaveBeenCalled());
  await waitFor(()=>expect(screen.queryByText('Loading messages…')).toBeNull());
  fireEvent.click(screen.getByRole('button',{name:'Browse visible messages'}));
  fireEvent.click(screen.getByText('Exact original message — punctuation intact.'));
  expect(container.querySelector('.timeline-message-body')).toHaveTextContent('Exact original message — punctuation intact.');
  fireEvent.keyDown(canvas,{key:'Home'});
  await waitFor(()=>expect(container.querySelector('.conversation-timeline')).toHaveAttribute('data-level','overview'));
  expect(container.querySelector('.timeline-message-body')).toBeNull();
 });
 it('discards late data when the user zooms back out',async()=>{
  let resolve!:(page:MessagePage)=>void;
  const getter=vi.fn(()=>new Promise<MessagePage>(done=>{resolve=done;}));
  const {canvas,container}=mount(getter);
  fireEvent.keyDown(canvas,{key:'Enter'});await waitFor(()=>expect(getter).toHaveBeenCalled());
  fireEvent.keyDown(canvas,{key:'Home'});await waitFor(()=>expect(container.querySelector('.conversation-timeline')).toHaveAttribute('data-level','overview'));
  resolve({episode_id:'stale',total:1,offset:0,next_offset:null,messages:[{id:'late',episode_id:'stale',turn_id:'turn',speaker:'me',timestamp:report.episodes![0].start,text:'Must not be displayed'}]});
  await new Promise(done=>setTimeout(done,30));
  expect(container).not.toHaveTextContent('Must not be displayed');
 });
});
