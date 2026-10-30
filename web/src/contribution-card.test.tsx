import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContributionCard } from "./components/experimental/ContributionCard";
import { realLikeSection } from "./fixtures/experimental-samples";

const dim = realLikeSection.dimensions.find((item) => item.key === "neuroticism")!;

function renderCard(active = true) {
  return render(<ContributionCard dim={dim} who="me" speaker={dim.per_speaker.me} quotes={realLikeSection.quotes} active={active} />);
}

describe("contribution hover card", () => {
  it("shows a compact preview on hover and stays open while moving into it", () => {
    vi.useFakeTimers();
    try {
      const view = renderCard();
      const trigger = screen.getByRole("button", { name: "Why this number for Me" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.pointerEnter(trigger);
      const card = screen.getByRole("dialog", { name: "Why this number" });
      expect(within(card).getAllByRole("listitem")).toHaveLength(5);
      expect(within(card).getByText("32.1%")).toBeInTheDocument();
      fireEvent.pointerLeave(trigger);
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.pointerEnter(card);
      act(() => { vi.advanceTimersByTime(300); });
      expect(card).toBeInTheDocument();
      fireEvent.pointerLeave(card);
      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("opens on keyboard focus and Escape returns focus without reopening", () => {
    renderCard();
    const trigger = screen.getByRole("button", { name: "Why this number for Me" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Close explanation" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("supports tap-to-pin, complete evidence, outside dismissal and section closure", () => {
    const view = renderCard();
    const trigger = screen.getByRole("button", { name: "Why this number for Me" });
    fireEvent.click(trigger, { detail: 1 });
    const card = screen.getByRole("dialog");
    const example = realLikeSection.quotes.find((quote) => dim.per_speaker.me.contributions.some((item) => item.quote_ids.includes(quote.id)))!;
    expect(within(card).getByText(example.text)).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "All 7 markers" }));
    const all = card.querySelector(".exp-contribution-all")! as HTMLElement;
    expect(within(all).getAllByRole("listitem")).toHaveLength(7);
    expect(within(all).getAllByText(example.text).length).toBeGreaterThan(0);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger, { detail: 1 });
    const anchorBox = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: -100, bottom: -20, left: 20, right: 220, width: 200, height: 80, x: 20, y: -100, toJSON: () => ({}) });
    fireEvent.scroll(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.scroll(window);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    anchorBox.mockRestore();
    fireEvent.click(trigger, { detail: 1 });
    view.rerender(<ContributionCard dim={dim} who="me" speaker={dim.per_speaker.me} quotes={realLikeSection.quotes} active={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps only one speaker preview open at a time", () => {
    render(<>
      <ContributionCard dim={dim} who="me" speaker={dim.per_speaker.me} quotes={realLikeSection.quotes} active />
      <ContributionCard dim={dim} who="other" speaker={dim.per_speaker.other!} quotes={realLikeSection.quotes} active />
    </>);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Why this number for Me" }));
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Why this number for Other person" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("Other person / Neuroticism");
    const me = screen.getByRole("button", { name: "Why this number for Me" });
    const other = screen.getByRole("button", { name: "Why this number for Other person" });
    act(() => me.focus());
    expect(screen.getByRole("dialog")).toHaveTextContent("Me / Neuroticism");
    act(() => other.focus());
    expect(screen.getByRole("dialog")).toHaveTextContent("Other person / Neuroticism");
    act(() => me.focus());
    expect(screen.getByRole("dialog")).toHaveTextContent("Me / Neuroticism");
  });
});
