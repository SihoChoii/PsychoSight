import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./components/DeleteDialog";

describe("deletion dialog keyboard and recovery", () => {
  it("starts at Cancel, wraps both ways, and restores focus after closing", () => {
    const onCancel=vi.fn(), onConfirm=vi.fn(); const trigger=document.createElement("button");document.body.append(trigger);trigger.focus();
    const v=render(<DeleteDialog open busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    const cancel=screen.getByRole("button",{name:"Cancel"}), confirm=screen.getByRole("button",{name:"Delete report"});
    expect(cancel).toHaveFocus();fireEvent.keyDown(cancel,{key:"Tab",shiftKey:true});expect(confirm).toHaveFocus();fireEvent.keyDown(confirm,{key:"Tab"});expect(cancel).toHaveFocus();
    v.rerender(<DeleteDialog open={false} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);expect(trigger).toHaveFocus();expect(document.body.style.overflow).toBe("");trigger.remove();
  });
  it("keeps Close operable while pending and never tabs to the disabled confirm", () => {
    const cancel=vi.fn();const v=render(<DeleteDialog open busy={false} onCancel={cancel} onConfirm={vi.fn()} />);
    screen.getByRole("button",{name:"Delete report"}).focus();v.rerender(<DeleteDialog open busy onCancel={cancel} onConfirm={vi.fn()} />);
    const close=screen.getByRole("button",{name:"Close"});expect(close).toHaveFocus();
    fireEvent.keyDown(close,{key:"Tab"});expect(close).toHaveFocus();fireEvent.keyDown(close,{key:"Tab",shiftKey:true});expect(close).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Deletion continues");fireEvent.click(close);expect(cancel).toHaveBeenCalledOnce();
  });
  it("keeps failures visible inside the decision and supports native Escape/backdrop", () => {
    const cancel=vi.fn();render(<DeleteDialog open busy={false} error="Deletion failed." onCancel={cancel} onConfirm={vi.fn()} />);
    const dialog=screen.getByRole("dialog");expect(within(dialog).getByRole("alert")).toHaveTextContent("Deletion failed.");expect(within(dialog).getByRole("button",{name:"Try again"})).toBeEnabled();
    fireEvent(dialog,new Event("cancel",{cancelable:true}));expect(cancel).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog,{clientX:-1,clientY:-1});expect(cancel).toHaveBeenCalledTimes(2);
    fireEvent.click(within(dialog).getByRole("heading"));expect(cancel).toHaveBeenCalledTimes(2);
  });
});
