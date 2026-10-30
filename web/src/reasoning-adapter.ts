/**
 * Wire names for reasoning on GET /config, POST /analyses, and run_meta.
 * Rename a value here if a field name changes.
 * There is no hint field on GET /config. The time-and-cost line is UI copy.
 */
export const reasoningFields = {
  levels: "reasoning_levels",
  defaultLevel: "default_reasoning",
  requestLevel: "reasoning_level",
  effort: "reasoning_effort",
} as const;

/** Keys on each entry of reasoning_levels. Rename a value here if the shape changes. */
export const reasoningLevelFields = {
  id: "id",
  label: "label",
  description: "description",
} as const;

/** Scale captions. Level names come from config and are not replaced by these. */
export const REASONING_QUICK_LABEL = "Quick";
export const REASONING_DEEP_LABEL = "Deep";
export const REASONING_HINT = "Deeper reasoning takes longer and costs more.";

/** Ids that mean no reasoning. The lowest other level is the fallback default. */
const ZERO_LEVEL_IDS = new Set(["none", "off", "zero", "0", "disabled"]);

export interface ReasoningLevel {
  id: string;
  label: string;
  description?: string;
}

export interface ReasoningControlModel {
  visible: boolean;
  levels: ReasoningLevel[];
  defaultIndex: number;
  hint: string;
}

const HIDDEN: ReasoningControlModel = {
  visible: false,
  levels: [],
  defaultIndex: 0,
  hint: REASONING_HINT,
};

interface DraftLevel {
  id: string;
  explicitLabel: string | null;
  description?: string;
}

export type ReasoningLevelDecision =
  | { ok: true; level: string | null }
  | { ok: false; code: "INVALID_REQUEST" | "INVALID_REASONING_LEVEL"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() === "" ? null : value;
}

function parseDraft(raw: unknown): DraftLevel | null {
  if (typeof raw === "string") {
    const id = raw.trim();
    if (!id) return null;
    return { id, explicitLabel: null };
  }
  if (!isRecord(raw)) return null;
  const idValue = raw[reasoningLevelFields.id];
  if (typeof idValue !== "string") return null;
  const id = idValue.trim();
  if (!id) return null;
  const explicitLabel = textOrNull(raw[reasoningLevelFields.label]);
  const description = textOrNull(raw[reasoningLevelFields.description]);
  return description ? { id, explicitLabel, description } : { id, explicitLabel };
}

function lowestNonZeroIndex(levels: ReasoningLevel[]): number {
  const found = levels.findIndex((level) => !ZERO_LEVEL_IDS.has(level.id.toLowerCase()));
  return found >= 0 ? found : 0;
}

/** Python repr for a str, so error text can match the backend message. */
function pythonStringRepr(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function readReasoningControl(config: unknown): ReasoningControlModel {
  if (!isRecord(config)) return HIDDEN;
  const rawLevels = config[reasoningFields.levels];
  if (!Array.isArray(rawLevels)) return HIDDEN;
  const drafts = rawLevels.map(parseDraft).filter((item): item is DraftLevel => item !== null);
  if (drafts.length === 0) return HIDDEN;
  const levels: ReasoningLevel[] = drafts.map((draft) => {
    const level: ReasoningLevel = {
      id: draft.id,
      label: draft.explicitLabel ?? draft.id,
    };
    if (draft.description) level.description = draft.description;
    return level;
  });
  const requested = textOrNull(config[reasoningFields.defaultLevel]);
  const matched = requested
    ? levels.findIndex((level) => level.id.toLowerCase() === requested.trim().toLowerCase())
    : -1;
  return {
    visible: true,
    levels,
    defaultIndex: matched >= 0 ? matched : lowestNonZeroIndex(levels),
    hint: REASONING_HINT,
  };
}

export function levelLabel(levels: readonly { id: string; label: string }[], id: string): string {
  const match = levels.find((level) => level.id.toLowerCase() === id.toLowerCase());
  return match?.label ?? id;
}

/**
 * POST /analyses reasoning_level.
 * Omitted or null is accepted (the server applies default_reasoning).
 * A non-string is INVALID_REQUEST. Any other string is INVALID_REASONING_LEVEL.
 * A matching id is returned in the canonical spelling from config.
 */
export function interpretReasoningLevel(value: unknown, config: unknown): ReasoningLevelDecision {
  if (value === undefined || value === null) return { ok: true, level: null };
  if (typeof value !== "string") {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: `Invalid request fields: ${reasoningFields.requestLevel}.`,
    };
  }
  const control = readReasoningControl(config);
  const match = control.levels.find((level) => level.id.toLowerCase() === value.trim().toLowerCase());
  if (match) return { ok: true, level: match.id };
  const ids = control.levels.map((level) => level.id);
  const listed = ids.length > 0 ? ids.join(", ") : "none, low, high, max";
  const fallback = control.levels[control.defaultIndex]?.id ?? "low";
  return {
    ok: false,
    code: "INVALID_REASONING_LEVEL",
    message: `${reasoningFields.requestLevel} ${pythonStringRepr(value)} is not supported. Valid values: ${listed} (default ${fallback}).`,
  };
}

export function attachReasoningLevel<T extends object>(
  body: T,
  input: { config: unknown; llmOptIn: boolean; reasoningLevel?: string | null },
): T {
  const control = readReasoningControl(input.config);
  const level = input.reasoningLevel;
  if (!input.llmOptIn || !control.visible || typeof level !== "string") return body;
  if (!control.levels.some((item) => item.id === level)) return body;
  return { ...body, [reasoningFields.requestLevel]: level } as T;
}
