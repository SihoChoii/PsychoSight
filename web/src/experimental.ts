import type { ExpContribution, ExpEvidence, ExperimentalScores, ExpSpeakerScore } from "./types";

/** Contract string for an insufficient_data speaker or section. Not a /config field. */
export const INSUFFICIENT_TEXT = "Not enough data (needs 20 episodes and 1,500 words)";

/** Contract fallback when a failed section has no reason string. */
export const FAILED_FALLBACK = "Experimental scores could not be computed for this run.";

/** Display names for family keys. These are not /config fields. */
export const FAMILY_LABEL: Record<string, string> = {
  big_five: "Big Five",
  wellbeing_language: "Well-being language",
  interpersonal: "Interpersonal language",
};

export const FAMILY_ORDER = ["big_five", "wellbeing_language", "interpersonal"] as const;

export function familyLabel(family: string): string {
  return FAMILY_LABEL[family] ?? family;
}

export function evidenceLabel(strength: ExpEvidence | string): string {
  return `Evidence ${strength.replaceAll("_", " ")}`;
}

/** Confidence is low or medium. Any other value, including high, is not shown. */
export function confidenceLabel(value: string | null | undefined): string | null {
  if (value === "low" || value === "medium") return `Confidence ${value}`;
  return null;
}

export function sourceLabel(source: ExpContribution["source"]): string {
  if (source === "D") return "Word count";
  if (source === "R") return "Episode AI rating";
  if (source === "H") return "One-off AI rating";
  return source;
}

export function directionText(direction: ExpContribution["direction"]): string {
  return direction === "down" ? "Lowers the index" : "Raises the index";
}

/** Effective weight, descending. Equal weights keep registry order. */
export function sortedContributions(items: ExpContribution[]): ExpContribution[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.weight - a.item.weight || a.index - b.index)
    .map(({ item }) => item);
}

export function basisText(speaker: Pick<ExpSpeakerScore, "n_episodes" | "n_words">): string {
  const episodes = speaker.n_episodes.toLocaleString("en-US");
  const words = speaker.n_words.toLocaleString("en-US");
  return `based on ${episodes} episodes / ${words} words`;
}

export function quotesFor(section: ExperimentalScores, ids: string[]) {
  const byId = new Map(section.quotes.map((quote) => [quote.id, quote]));
  return ids.map((id) => byId.get(id)).filter((quote): quote is NonNullable<typeof quote> => !!quote);
}

export function sectionMessage(section: ExperimentalScores): string | null {
  if (section.status === "insufficient_data") return INSUFFICIENT_TEXT;
  if (section.status === "not_run") return section.reason ?? "Not run.";
  if (section.status === "failed") return section.reason ?? FAILED_FALLBACK;
  return null;
}

export function speakerMessage(speaker: ExpSpeakerScore): string | null {
  if (speaker.status === "ok") return null;
  if (speaker.status === "insufficient_data") return INSUFFICIENT_TEXT;
  if (speaker.status === "failed") return speaker.reason ?? FAILED_FALLBACK;
  return speaker.reason ?? "Not run.";
}
