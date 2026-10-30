import type { Cell, Feature, Report } from '../types';

export interface FeatureSummary {
  key: string;
  title: string;
  reading: string;
  context: string;
  unit: string;
  metrics: { label: string; feature: Feature }[];
}

/** Summaries use supplied overall values. Never average weekly percentages or infer motives. */
export function measuredValue(cell: Cell | undefined, feature: Feature): number | null {
  const value = cell?.value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!feature.unit.startsWith('%') || value <= 100) ? value : null;
}
export function summaryValue(cell: Cell | undefined, feature: Feature): string {
  const value = measuredValue(cell, feature);
  if (value === null) return 'Not enough data';
  if (feature.key === 'reply_latency_median_s') {
    // Convert seconds without losing precision; exact seconds remain in the chart's data view.
    if (value < 60) return `${value}s`;
    if (!Number.isSafeInteger(Math.trunc(value)) || String(value).includes('e')) return `${value}s`;
    const minutes = Math.floor(value / 60), seconds = Math.trunc(value) % 60, fraction = String(value).split('.')[1];
    return `${minutes}m${seconds || fraction ? ` ${seconds}${fraction ? `.${fraction}` : ''}s` : ''}`;
  }
  return `${value}${feature.unit.startsWith('%') ? '%' : ''}`;
}
function comparison(feature: Feature, higher: string, lower: string, equal: string, missing: string) {
  const me = measuredValue(feature.overall.me, feature), other = measuredValue(feature.overall.other, feature);
  return me === null || other === null ? missing : me > other ? higher : me < other ? lower : equal;
}
export function buildFeatureSummaries(report: Pick<Report, 'series'>): FeatureSummary[] {
  const features = new Map(report.series.map(feature => [feature.key, feature]));
  const summaries: FeatureSummary[] = [];
  const add = (key: string, title: string, unit: string, context: string, reading: (feature: Feature) => string) => {
    const feature = features.get(key);
    if (feature) summaries.push({ key, title, unit, context, reading: reading(feature), metrics: [{ label: title, feature }] });
  };
  add('initiation_pct', 'Starting conversations', 'Share of episodes opened',
    'This records who sends the first message when an exchange begins after a gap.',
    feature => comparison(feature, 'You opened more of the recorded episodes.', 'The other person opened more of the recorded episodes.',
      'You each opened the same share of episodes.', 'More episodes are needed to compare who starts exchanges.'));
  add('reply_latency_median_s', 'Reply timing', 'Median reply time · approximate',
    'The median is the middle recorded delay between speakers within an episode. Availability and context can affect it.',
    feature => comparison(feature, 'The other person’s median reply time was shorter.', 'Your median reply time was shorter.',
      'Your recorded median reply times were the same.', 'Reply timing needs enough replies from both people for a comparison.'));
  add('double_text_pct', 'Following up', 'Share of each person’s turns',
    'A follow-up is a new turn from the same person before the other person replies. Several messages sent together can form one turn.',
    feature => comparison(feature, 'You had a higher follow-up rate.', 'The other person had a higher follow-up rate.',
      'You had the same recorded follow-up rate.', 'There are not enough turns to compare follow-up rates.'));

  const i = features.get('i_pct'), we = features.get('we_pct');
  if (i || we) {
    let reading = 'Both word groups need enough text for a comparison.';
    if (i && we) {
      const a = measuredValue(i.overall.me, i), b = measuredValue(we.overall.me, we), c = measuredValue(i.overall.other, i), d = measuredValue(we.overall.other, we);
      if (a !== null && b !== null && c !== null && d !== null) {
        reading = a > b && c > d ? 'Both of you use I-words more often than we-words.'
          : a < b && c < d ? 'Both of you use we-words more often than I-words.'
          : a === b && c === d ? 'Both word groups have the same recorded rate for each of you.'
          : 'The mix of I-words and we-words differs between you.';
      }
    }
    summaries.push({ key: 'pronouns', title: 'I-words and we-words', unit: 'Share of words', reading,
      context: 'These count references such as “I” and “me”, or “we” and “us”. What you are discussing shapes the wording.',
      metrics: [...(i ? [{ label: 'I-words', feature: i }] : []), ...(we ? [{ label: 'We-words', feature: we }] : [])] });
  }
  add('absolutist_pct', 'Absolute wording', 'Share of words matching the list',
    'A fixed 19-word list includes words such as “always” and “never”. Matches after “not”, “almost” or “nearly” are skipped.',
    feature => {
      const me = measuredValue(feature.overall.me, feature), other = measuredValue(feature.overall.other, feature);
      return me === null || other === null ? 'More text is needed to compare these word rates.'
        : me === 0 && other === 0 ? 'No words matched the list for either person.'
        : me > 0 && other > 0 ? 'Words from the list appear in both sets of messages.'
        : me > 0 ? 'The list matched words in your messages.' : 'The list matched words in the other person’s messages.';
    });
  add('late_night_episodes', 'Late-night starts', 'Episodes opened · local time',
    'Only episode starts between 01:00 and 04:00 count here. Later messages in the same episode do not add to the count.',
    feature => {
      const me = measuredValue(feature.overall.me, feature), other = measuredValue(feature.overall.other, feature);
      if (me === null || other === null) return 'The late-night count is unavailable for one or both people.';
      const total = me + other;
      return total === 0 ? 'No episodes started between 01:00 and 04:00.' : `${total} ${total === 1 ? 'episode began' : 'episodes began'} between 01:00 and 04:00.`;
    });
  return summaries;
}
