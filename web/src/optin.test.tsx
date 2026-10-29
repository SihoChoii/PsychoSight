import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import mockConfig from "./fixtures/mock-config.json";
import { OptIn } from "./components/OptIn";

function pythonAssignment(name: string, source: string): string {
  const wrapped = source.indexOf(`${name} = (`);
  if (wrapped !== -1) {
    const end = source.indexOf("\n)", wrapped);
    const block = source.slice(wrapped, end);
    return [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`)).join("");
  }
  const line = source.match(new RegExp(`${name} = ("(?:[^"\\\\]|\\\\.)*")`));
  if (!line) throw new Error(`Missing ${name}`);
  return JSON.parse(line[1]);
}

describe("opt-in disclosure", () => {
  it("renders the provided text verbatim", () => {
    const sentinel = "SENTINEL ¶ both sides — DeepSeek. Do not paraphrase this disclosure.";
    render(<OptIn text={sentinel} busy={false} error={null} onOptIn={() => {}} onLocalOnly={() => {}} />);
    expect(screen.getByTestId("opt-in-text").textContent).toBe(sentinel);
  });

  it("keeps the mock snapshot identical to the backend opt_in_text", () => {
    const source = readFileSync(path.resolve(process.cwd(), "../psychosight/config.py"), "utf8");
    expect(mockConfig.opt_in_text).toBe(pythonAssignment("OPT_IN_TEXT", source));
    expect(mockConfig.disclaimer).toBe(pythonAssignment("DISCLAIMER", source));
    render(
      <OptIn text={mockConfig.opt_in_text} busy={false} error={null} onOptIn={() => {}} onLocalOnly={() => {}} />,
    );
    expect(screen.getByTestId("opt-in-text").textContent).toBe(mockConfig.opt_in_text);
    expect(screen.getByRole("button", { name: "Deterministic only, no LLM" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send excerpts and analyze" })).toBeEnabled();
  });
});
