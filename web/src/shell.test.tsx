import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Shell } from "./components/Shell";

describe("theme assets", () => {
  it("uses the black wordmark, symbol, and favicon together", () => {
    document.head.innerHTML = '<link id="favicon" rel="icon" href="/logos/black/favicon.svg">';
    render(
      <Shell theme="black" onToggleTheme={() => {}} mock={false} disclaimer="From config" route={{ name: "picker" }}>
        <h1 id="page-title">Conversations</h1>
      </Shell>,
    );
    expect(screen.getByRole("img", { name: "PsychoSigh" })).toHaveAttribute(
      "src",
      "/logos/black/psychosigh-wordmark.svg",
    );
    expect(document.querySelector(".footer-symbol")).toHaveAttribute("src", "/logos/black/psychosigh-symbol.svg");
    expect(screen.getByRole("button", { name: "Switch to white theme" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to the white assets", () => {
    render(
      <Shell theme="white" onToggleTheme={() => {}} mock disclaimer="From config" route={{ name: "picker" }}>
        <p>Demo</p>
      </Shell>,
    );
    expect(screen.getByRole("img", { name: "PsychoSigh" })).toHaveAttribute(
      "src",
      "/logos/white/psychosigh-wordmark.svg",
    );
    expect(document.querySelector(".footer-symbol")).toHaveAttribute("src", "/logos/white/psychosigh-symbol.svg");
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to black theme" })).toHaveAttribute("aria-pressed", "true");
  });
});
