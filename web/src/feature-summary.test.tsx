import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import sample from '../../docs/sample_report.json';
import { buildFeatureSummaries, summaryValue } from './charts/feature-summaries';
import { FeatureSummary } from './components/report/FeatureSummary';
import { ReportView } from './components/ReportView';
import type { Report } from './types';

const report = sample as Report;
const feature = (r: Report, key: string) => r.series.find(f => f.key === key)!;
const summaries = (r: Report) => new Map(buildFeatureSummaries(r).map(s => [s.key, s]));

describe('plain-language feature summaries', () => {
  it('reads whole-report values, not weekly averages, and keeps the correct units', () => {
    const data = structuredClone(report);
    data.series.forEach(f => { f.points = f.points.map(p => ({...p, me:{value:0,count:0}, other:{value:100,count:1}})); });
    const cards = summaries(data);
    expect(cards.size).toBe(6);
    expect(cards.get('initiation_pct')!.reading).toBe('You opened more of the recorded episodes.');
    expect(cards.get('reply_latency_median_s')!.reading).toBe('Your median reply time was shorter.');
    expect(cards.get('late_night_episodes')!.reading).toBe('13 episodes began between 01:00 and 04:00.');
    expect(cards.get('late_night_episodes')!.unit).not.toContain('%');
    expect(cards.get('pronouns')!.metrics.map(m => m.feature.key)).toEqual(['i_pct','we_pct']);
  });
  it('handles ties, reversals and real zeros without assigning a psychological label', () => {
    const data = structuredClone(report);
    const init=feature(data,'initiation_pct'), follow=feature(data,'double_text_pct'), absolute=feature(data,'absolutist_pct'), late=feature(data,'late_night_episodes');
    init.overall.me.value=30;init.overall.other.value=70;
    follow.overall.me.value=0;follow.overall.other.value=0;
    absolute.overall.me.value=0;absolute.overall.other.value=0;
    late.overall.me.value=0;late.overall.other.value=0;
    const cards=summaries(data);
    expect(cards.get('initiation_pct')!.reading).toContain('The other person opened more');
    expect(cards.get('double_text_pct')!.reading).toContain('same recorded follow-up rate');
    expect(cards.get('absolutist_pct')!.reading).toBe('No words matched the list for either person.');
    expect(cards.get('late_night_episodes')!.reading).toBe('No episodes started between 01:00 and 04:00.');
    expect(summaryValue(absolute.overall.me,absolute)).toBe('0%');
  });
  it('does not compare partial, null or invalid values and does not fabricate omitted features', () => {
    const data=structuredClone(report);
    feature(data,'reply_latency_median_s').overall.other.value=null;
    feature(data,'initiation_pct').overall.me.value=Infinity;
    feature(data,'double_text_pct').overall.me.value=101;
    feature(data,'late_night_episodes').overall.other.value=null;
    data.series=data.series.filter(f=>f.key!=='absolutist_pct'&&f.key!=='we_pct');
    const cards=summaries(data);
    expect(cards.size).toBe(5);
    expect(cards.get('reply_latency_median_s')!.reading).toContain('needs enough replies');
    expect(cards.get('initiation_pct')!.reading).not.toContain('more of');
    expect(cards.get('double_text_pct')!.reading).not.toContain('higher');
    expect(cards.get('late_night_episodes')!.reading).toContain('unavailable');
    expect(cards.get('pronouns')!.metrics).toHaveLength(1);
    expect(cards.get('pronouns')!.reading).toContain('need enough text');
    render(<FeatureSummary report={data}/>);
    const table=screen.getByRole('table',{name:'Whole-conversation pronoun rates'});
    expect(within(table).getByRole('row',{name:/I-words/})).toBeInTheDocument();
    expect(within(table).queryByRole('row',{name:/We-words/})).toBeNull();
  });
  it('converts reply seconds without dropping supplied decimal precision', () => {
    const f=feature(report,'reply_latency_median_s');
    for(const [value,text] of [[0,'0s'],[59.2,'59.2s'],[60,'1m'],[84,'1m 24s'],[93.123456789,'1m 33.123456789s'],[120,'2m']] as const)
      expect(summaryValue({value,count:4},f)).toBe(text);
    expect(summaryValue({value:null,count:1},f)).toBe('Not enough data');
  });
  it('keeps summaries free of duplicate info cards and retains exact count bases in chart data', async () => {
    const {container}=render(<ReportView report={report} deleting={false} deleteError={null} onDelete={vi.fn()}/>);
    const region=screen.getByRole('region',{name:'Reading the patterns'});
    expect(within(region).getAllByRole('article')).toHaveLength(6);
    expect(region.querySelector('.report-info-button')).toBeNull();
    fireEvent.click(within(region).getByRole('button',{name:'View weekly pattern: Episodes opened'}));
    const init=container.querySelector('figure[data-feature="initiation_pct"]')!;
    fireEvent.click(within(init as HTMLElement).getByRole('button',{name:'View data: Episodes opened'}));
    const data=screen.getByRole('dialog',{name:'Episodes opened · full report data'});
    expect(data).toHaveTextContent('104 episodes opened by this speaker; 191 total episodes (percentage denominator)');
    fireEvent.click(within(data).getByRole('button',{name:'Close Episodes opened · full report data'}));
    await waitFor(()=>expect(data).not.toBeInTheDocument());
    fireEvent.click(within(region).getByRole('button',{name:'View weekly pattern: Median reply time'}));
    const reply=container.querySelector('figure[data-feature="reply_latency_median_s"]')!;
    fireEvent.click(within(reply as HTMLElement).getByRole('button',{name:'View data: Median reply time'}));
    const replyData=screen.getByRole('dialog',{name:'Median reply time · full report data'});
    expect(replyData).toHaveTextContent('84 seconds');expect(replyData).toHaveTextContent('based on 1635 replies');
    const late=within(region).getByRole('article',{name:'Late-night starts'});
    expect(late).not.toHaveTextContent('%');
  });
  it('sits after the raw charts and navigates back without changing the report or its whole-report summary', () => {
    const {container}=render(<ReportView report={report} deleting={false} deleteError={null} onDelete={vi.fn()}/>);
    const summary=container.querySelector('.feature-summary')!, chart=container.querySelector('figure[data-feature="reply_latency_median_s"]')!;
    expect(chart.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const initial=summary.textContent;
    fireEvent.click(within(summary as HTMLElement).getByRole('button',{name:'View weekly pattern: Median reply time'}));
    expect(document.activeElement?.id).toBe('report-feature-reply_latency_median_s');
    fireEvent.keyDown(chart.querySelector('svg[role="img"]')!,{key:'Home'});
    expect(summary.textContent).toBe(initial);
    const navigation=screen.getByRole('navigation',{name:'Report sections'});
    document.getElementById('feature-summary-title')!.scrollIntoView=vi.fn();
    fireEvent.click(within(navigation).getByText('Explore report'));
    fireEvent.click(within(navigation).getByRole('button',{name:'Reading the patterns'}));
    expect(document.activeElement?.id).toBe('feature-summary-title');
  });
});
