import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import mockConfig from "./fixtures/mock-config.json";
import { OptIn } from "./components/OptIn";

function pythonAssignment(name: string, source: string): string {
  const token = `${name} =`;
  const at = source.indexOf(token);
  if (at === -1) throw new Error(`Missing ${name}`);
  let i = at + token.length;
  while (source[i] === " " || source[i] === "\n") i += 1;
  const grouped = source[i] === "(";
  if (grouped) i += 1;
  const parts: string[] = [];
  while (i < source.length) {
    while (source[i] === " " || source[i] === "\n") i += 1;
    if (grouped && source[i] === ")") break;
    if (source[i] !== '"') break;
    i += 1;
    let buf = "";
    while (i < source.length) {
      if (source[i] === "\\") {
        const next = source[i + 1];
        buf += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
        continue;
      }
      if (source[i] === '"') {
        i += 1;
        break;
      }
      buf += source[i];
      i += 1;
    }
    parts.push(buf);
    if (!grouped) break;
  }
  if (parts.length === 0) throw new Error(`Missing ${name}`);
  return parts.join("");
}

describe("opt-in disclosure", () => {
  it("renders the provided text verbatim", () => {
    const sentinel = "SENTINEL ¶ both sides — DeepSeek. Do not paraphrase this disclosure.";
    render(<OptIn text={sentinel} busy={false} error={null} onOptIn={() => {}} onLocalOnly={() => {}} />);
    expect(screen.getByTestId("opt-in-text").textContent).toBe(sentinel);
  });

  it("keeps the mock snapshot identical to the backend opt_in_text", () => {
    const source = readFileSync(path.resolve(process.cwd(), "../psychosight/config.py"), "utf8");
    const strings = readFileSync(path.resolve(process.cwd(), "../psychosight/experimental/strings.py"), "utf8");
    const contract = readFileSync(path.resolve(process.cwd(), "../psychosight/experimental/contract.py"), "utf8");
    expect(mockConfig.opt_in_text).toBe(pythonAssignment("OPT_IN_TEXT", source));
    expect(mockConfig.disclaimer).toBe(pythonAssignment("DISCLAIMER", source));
    expect(mockConfig.schema_version).toBe(pythonAssignment("SCHEMA_VERSION", source));
    expect(mockConfig.demo_provider_note).toBe(pythonAssignment("MOCK_NOTE_NO_KEY", source));
    expect(mockConfig.experimental_opt_in_text).toBe(pythonAssignment("EXPERIMENTAL_CONSENT", strings));
    expect(mockConfig.score_other_opt_in_text).toBe(pythonAssignment("SCORE_OTHER_CONSENT", strings));
    expect(mockConfig.experimental_banner).toBe(pythonAssignment("BANNER", strings));
    expect(mockConfig.experimental_footer_support).toBe(pythonAssignment("FOOTER_SUPPORT", strings));
    expect(mockConfig.experimental_scale_note).toBe(pythonAssignment("SCALE_NOTE", strings));
    expect(mockConfig.experimental_how_it_works).toBe(pythonAssignment("HOW_IT_WORKS", strings));
    expect(mockConfig.experimental_enabled).toBe(true);
    const labels = pythonDict("DIMENSION_LABELS", strings);
    const dims = [...contract.matchAll(/_dim\("([^"]+)", "([^"]+)", "([^"]+)"/g)].map((match) => ({
      key: match[1],
      family: match[2],
      evidence_strength: match[3],
      label: labels[match[1]],
    }));
    expect(mockConfig.experimental_dimensions).toEqual(dims);
    render(
      <OptIn text={mockConfig.opt_in_text} busy={false} error={null} onOptIn={() => {}} onLocalOnly={() => {}} />,
    );
    expect(screen.getByTestId("opt-in-text").textContent).toBe(mockConfig.opt_in_text);
    expect(screen.getByRole("button", { name: "Deterministic only, no LLM" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeEnabled();
  });
});

function pythonDict(name: string, source: string): Record<string, string> {
  const start = source.indexOf(name);
  const brace = source.indexOf("{", start);
  const end = source.indexOf("\n}", brace);
  const block = source.slice(brace, end);
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/"([^"]+)": "((?:[^"\\]|\\.)*)"/g)) {
    out[match[1]] = JSON.parse(`"${match[2]}"`);
  }
  return out;
}
