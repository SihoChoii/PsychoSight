import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./components/Shell";
import { applyTheme, currentTheme, THEME_KEY } from "./mode";
import { parseHash } from "./routes";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.removeItem(THEME_KEY);
  document.documentElement.dataset.theme = "black";
});

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

  it("persists the selected theme and switches the favicon with the canvas", () => {
    document.head.innerHTML = '<link id="favicon" rel="icon" href="/logos/black/favicon.svg">';
    applyTheme("white");
    expect(currentTheme()).toBe("white");
    expect(localStorage.getItem(THEME_KEY)).toBe("white");
    expect(document.getElementById("favicon")).toHaveAttribute("href", "/logos/white/favicon.svg");
    applyTheme("black");
    expect(currentTheme()).toBe("black");
    expect(localStorage.getItem(THEME_KEY)).toBe("black");
    expect(document.getElementById("favicon")).toHaveAttribute("href", "/logos/black/favicon.svg");
  });
});

describe("in-page navigation", () => {
  it.each(["#/", "#/optin", "#/run/preview", "#/report/sample-full"])(
    "scrolls and focuses content without replacing route %s",
    (hash) => {
      window.history.replaceState(null, "", `/?mock=1${hash}`);
      const onToggleTheme = vi.fn();
      render(
        <Shell theme="black" onToggleTheme={onToggleTheme} mock disclaimer={null} route={parseHash(hash)}>
          <h1 id="page-title">Current task</h1>
        </Shell>,
      );
      const main = screen.getByRole("main");
      main.scrollIntoView = vi.fn();
      for (const label of ["Skip to content", "Back to top"]) {
        screen.getByRole("link", { name: label }).focus();
        expect(fireEvent.click(screen.getByRole("link", { name: label }))).toBe(false);
        expect(main).toHaveFocus();
        expect(window.location.hash).toBe(hash);
      }
      expect(main.scrollIntoView).toHaveBeenCalledTimes(2);
      expect(main.scrollIntoView).toHaveBeenLastCalledWith({ block: "start" });
      fireEvent.click(screen.getByRole("button", { name: "Switch to white theme" }));
      expect(onToggleTheme).toHaveBeenCalledOnce();
      expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute("href", "#/");
    },
  );
});
