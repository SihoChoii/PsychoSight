import stubJson from "../../../docs/sample_experimental_scores.json";
import type {
  ExpContribution,
  ExpDimension,
  ExperimentalScores,
  ExpSpeakerScore,
  ExpTrendPoint,
} from "../types";

const stub = stubJson as ExperimentalScores;

function shell(status: ExperimentalScores["status"], reason: string | null, speakers: ExperimentalScores["speakers_scored"]): Omit<ExperimentalScores, "dimensions" | "quotes"> {
  return {
    status,
    reason,
    banner: stub.banner,
    title: stub.title,
    scale_note: stub.scale_note,
    footer_support: stub.footer_support,
    how_it_works: stub.how_it_works,
    scoring_version: stub.scoring_version,
    prompt_versions: { ...stub.prompt_versions },
    anchors_version: stub.anchors_version,
    speakers_scored: speakers,
    thresholds: { ...stub.thresholds },
  };
}

function cloneSpeaker(speaker: ExpSpeakerScore): ExpSpeakerScore {
  return {
    ...speaker,
    band: speaker.band ? { ...speaker.band } : null,
    contributions: speaker.contributions.map((item) => ({ ...item, quote_ids: [...item.quote_ids] })),
    trend: speaker.trend.map((point) => ({ ...point })),
    quote_ids: [...speaker.quote_ids],
  };
}

function wideBand(score: number): { lo: number; hi: number } {
  let lo = Math.max(0, score - 30);
  let hi = Math.min(100, score + 30);
  if (hi - lo < 40) {
    if (lo === 0) hi = Math.min(100, lo + 40);
    else hi = 100;
    lo = Math.max(0, hi - 40);
  }
  return { lo, hi };
}

function widen(band: { lo: number; hi: number }, extra: number): { lo: number; hi: number } {
  return { lo: Math.max(0, band.lo - extra), hi: Math.min(100, band.hi + extra) };
}

function okTemplate(dim: ExpDimension): ExpSpeakerScore {
  const donor = dim.per_speaker.me.status === "ok" ? dim.per_speaker.me : dim.per_speaker.other;
  if (donor && donor.status === "ok" && donor.score !== null && donor.band) return cloneSpeaker(donor);
  return {
    status: "ok",
    reason: null,
    score: 40,
    band: wideBand(40),
    confidence: "low",
    n_episodes: 33,
    n_words: 4100,
    contributions: [],
    trend: [],
    quote_ids: [],
  };
}

function asNotRunMarkers(items: ExpContribution[]): ExpContribution[] {
  const next = items.map((item) => {
    if (item.source === "D" && item.status === "ok") return { ...item, quote_ids: [...item.quote_ids] };
    return {
      ...item,
      status: "not_run" as const,
      weight: 0,
      value: null,
      sub_score: null,
      quote_ids: [] as string[],
    };
  });
  const sum = next.filter((item) => item.status === "ok").reduce((total, item) => total + item.weight, 0);
  if (sum > 0) {
    for (const item of next) {
      if (item.status === "ok") item.weight = Math.round((item.weight / sum) * 1000) / 1000;
    }
  }
  return next;
}

function trendFrom(points: ExpTrendPoint[], overall: number): ExpTrendPoint[] {
  if (points.length > 0) return points.map((point) => ({ ...point }));
  return ["2025-W40", "2025-W41", "2025-W42", "2025-W43"].map((week, index) => ({
    week,
    score: Math.max(0, overall - 18 + index),
    n_episodes: 6,
    n_words: 480,
    reason: null,
  }));
}

function realSpeaker(dim: ExpDimension, who: "me" | "other"): ExpSpeakerScore {
  const current = dim.per_speaker[who];
  const base = current && current.status === "ok" && current.score !== null && current.band ? cloneSpeaker(current) : okTemplate(dim);
  const bigFive = dim.family === "big_five";
  const score = base.score ?? 40;
  base.status = "ok";
  base.reason = null;
  base.score = score;
  base.confidence = bigFive ? "medium" : "low";
  base.band = bigFive && base.band ? { ...base.band } : wideBand(score);
  base.n_episodes = Math.max(base.n_episodes, 30);
  base.n_words = Math.max(base.n_words, 3000);
  if (who === "other" && current?.status !== "ok") {
    base.score = Math.max(0, Math.min(100, score - 7));
    base.band = bigFive ? { lo: Math.max(0, base.score - 14), hi: Math.min(100, base.score + 14) } : wideBand(base.score);
    base.contributions = base.contributions.map((item) => ({ ...item, quote_ids: [] }));
    base.quote_ids = [];
  }
  base.trend = trendFrom(base.trend, base.score);
  return base;
}

function detSpeaker(dim: ExpDimension, who: "me" | "other"): ExpSpeakerScore {
  const speaker = realSpeaker(dim, who);
  const score = speaker.score ?? 40;
  speaker.confidence = "low";
  speaker.band = speaker.band ? widen(speaker.band, 10) : wideBand(score);
  speaker.contributions = asNotRunMarkers(speaker.contributions);
  speaker.quote_ids = speaker.contributions.flatMap((item) => item.quote_ids);
  return speaker;
}

function mapDimensions(build: (dim: ExpDimension, who: "me" | "other") => ExpSpeakerScore): ExpDimension[] {
  return stub.dimensions.map((dim) => ({
    ...dim,
    citations: dim.citations.map((item) => ({ ...item })),
    per_speaker: {
      me: build(dim, "me"),
      other: build(dim, "other"),
    },
  }));
}

function blankSpeaker(status: ExpSpeakerScore["status"], reason: string): ExpSpeakerScore {
  return {
    status,
    reason,
    score: null,
    band: null,
    confidence: null,
    n_episodes: status === "insufficient_data" ? 8 : 0,
    n_words: status === "insufficient_data" ? 400 : 0,
    contributions: [],
    trend: [],
    quote_ids: [],
  };
}

/** Hand-written contract sample, including one insufficient_data speaker. */
export const stubSection: ExperimentalScores = stub;

/** Both speakers scored, no insufficient_data. Big Five medium; the rest low with wide bands. */
export const realLikeSection: ExperimentalScores = {
  ...shell("ok", null, ["me", "other"]),
  dimensions: mapDimensions(realSpeaker),
  quotes: stub.quotes.map((quote) => ({ ...quote })),
};

/** Word-count markers only. Episode and one-off AI ratings are not_run. Confidence stays low. */
export const deterministicSection: ExperimentalScores = {
  ...shell("ok", null, ["me", "other"]),
  dimensions: mapDimensions(detSpeaker),
  quotes: stub.quotes
    .filter((quote) => !quote.marker_key.startsWith("llm.") && !quote.marker_key.startsWith("holistic."))
    .map((quote) => ({ ...quote })),
};

/** The other person was not scored, including on not_run and failed reports. */
export function withNullOther(section: ExperimentalScores): ExperimentalScores {
  return {
    ...section,
    speakers_scored: ["me"],
    dimensions: section.dimensions.map((dim) => ({
      ...dim,
      per_speaker: { me: dim.per_speaker.me, other: null },
    })),
  };
}

export const nullOtherSection: ExperimentalScores = withNullOther(realLikeSection);

export const failedSection: ExperimentalScores = {
  ...shell("failed", "Experimental scores could not be computed for this run.", ["me"]),
  dimensions: stub.dimensions.map((dim) => ({
    ...dim,
    citations: dim.citations.map((item) => ({ ...item })),
    per_speaker: {
      me: blankSpeaker("failed", "Experimental scores could not be computed for this run."),
      other: null,
    },
  })),
  quotes: [],
};

export const notRunSection: ExperimentalScores = {
  ...shell("not_run", "not requested", ["me"]),
  dimensions: stub.dimensions.map((dim) => ({
    ...dim,
    citations: dim.citations.map((item) => ({ ...item })),
    per_speaker: {
      me: blankSpeaker("not_run", "not requested"),
      other: null,
    },
  })),
  quotes: [],
};

export const insufficientSection: ExperimentalScores = {
  ...shell("insufficient_data", "fewer than 20 episodes for this person", ["me", "other"]),
  dimensions: stub.dimensions.map((dim) => ({
    ...dim,
    citations: dim.citations.map((item) => ({ ...item })),
    per_speaker: {
      me: blankSpeaker("insufficient_data", "fewer than 20 episodes for this person"),
      other: blankSpeaker("insufficient_data", "fewer than 1,500 words for this person"),
    },
  })),
  quotes: [],
};

/** UI-only stress case: explicit/omitted weeks, precise inputs, missing evidence and speaker states. */
export const detailStressSection: ExperimentalScores = (() => {
  const section = structuredClone(realLikeSection);
  const first = section.dimensions[0].per_speaker.me;
  first.trend = [
    { week: "2025-W40", score: 14, n_episodes: 4, n_words: 401, reason: null },
    { week: "2025-W41", score: null, n_episodes: 2, n_words: 201, reason: "fewer than 300 words or 3 episodes this week" },
    { week: "2025-W43", score: 21, n_episodes: 6, n_words: 601, reason: null },
    { week: "2025-W44", score: 0, n_episodes: 3, n_words: 333, reason: null },
  ];
  first.contributions[0].value = 0.123456789;
  first.contributions[0].quote_ids = ["xq_ui_long", "xq_missing"];
  first.contributions[1].status = "no_data";
  first.contributions[1].weight = 0;
  first.contributions[1].value = null;
  first.contributions[1].sub_score = null;
  first.quote_ids = [...new Set([...first.quote_ids, "xq_ui_long", "xq_missing"])];
  section.quotes.push({ id: "xq_ui_long", speaker: "me", episode_id: "ep-0001", marker_key: first.contributions[0].marker_key,
    text: "A supplied synthetic quote, with punctuation and a newline.\n" + "longunbrokenword".repeat(16), ts: "2025-10-01T18:03:04-07:00" });
  for (const [index, status] of [[1, "failed"], [2, "not_run"], [3, "insufficient_data"]] as const) {
    const speaker = section.dimensions[index].per_speaker.me;
    speaker.status = status; speaker.score = null; speaker.band = null; speaker.confidence = null;
    speaker.reason = status === "failed" ? "Experimental scores could not be computed for this run." : status === "not_run" ? "AI scoring was not run for this report" : "fewer than 20 episodes for this person";
  }
  return section;
})();
