import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiskAccess } from "./components/DiskAccess";

describe("Full Disk Access screen", () => {
  it("shows the steps and calls settings, recheck, and Finder actions", () => {
    const onOpenSettings = vi.fn();
    const onRecheck = vi.fn();
    const onReveal = vi.fn();
    const onDemo = vi.fn();
    render(
      <DiskAccess
        message="Cannot read Messages."
        note="Quit PsychoSight and open it again."
        busy={false}
        onOpenSettings={onOpenSettings}
        onRecheck={onRecheck}
        onReveal={onReveal}
        onDemo={onDemo}
      />,
    );
    expect(screen.getByRole("heading", { name: "Full Disk Access" })).toBeInTheDocument();
    expect(screen.getByText("Choose Open Full Disk Access Settings.")).toBeInTheDocument();
    expect(screen.getByText(/Turn on PsychoSight/)).toBeInTheDocument();
    expect(screen.getAllByText("Quit PsychoSight and open it again.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Open Full Disk Access Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Recheck" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    fireEvent.click(screen.getByRole("button", { name: "Try demo conversation" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onRecheck).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onDemo).toHaveBeenCalledTimes(1);
  });
});
