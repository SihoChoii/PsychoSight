import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "./mock";
import { Picker } from "./components/Picker";
import {
  buildServerPage,
  conversationFields,
  interpretConversationsResponse,
  mapConversation,
  toWire,
  type ConversationQuery,
  type ConversationsFetch,
} from "./conversation-adapter";
import { MOCK_CATALOG } from "./fixtures/conversations";
import type { Report } from "./types";
import { ReportView } from "./components/ReportView";

function serverFetch(query: ConversationQuery): Promise<ConversationsFetch> {
  return Promise.resolve(buildServerPage(MOCK_CATALOG, query));
}

function renderPicker(fetchConversations = vi.fn(serverFetch), debounceMs = 0) {
  const onContinue = vi.fn();
  render(
    <Picker
      theme="black"
      saved={[]}
      activeJobId={null}
      flash={null}
      debounceMs={debounceMs}
      fetchConversations={fetchConversations}
      onContinue={onContinue}
    />,
  );
  return { onContinue, fetchConversations };
}

async function ready() {
  return screen.findByRole("radio", { name: /Demo conversation/ });
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("conversation date defaults", () => {
  it("defaults From and To to the conversation dates and shows the span", async () => {
    const { onContinue } = renderPicker();
    await ready();
    expect(screen.getByText("Conversation spans Aug 4, 2025 to Feb 1, 2026. 4259 messages.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2025-08-04");
    expect(screen.getByLabelText("To")).toHaveValue("2026-02-01");
    expect(screen.getByLabelText("From")).toHaveAttribute("min", "2025-08-04");
    expect(screen.getByLabelText("From")).toHaveAttribute("max", "2026-02-01");
    expect(screen.getByLabelText("To")).toHaveAttribute("min", "2025-08-04");
    expect(screen.getByLabelText("To")).toHaveAttribute("max", "2026-02-01");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "demo", dateFrom: "2025-08-04", dateTo: "2026-02-01" }),
    );
  });

  it("resets a custom range and keeps it when the next conversation still covers it", async () => {
    renderPicker();
    await ready();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2025-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to full range" }));
    expect(screen.getByLabelText("From")).toHaveValue("2025-08-04");
    expect(screen.getByLabelText("To")).toHaveValue("2026-02-01");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2025-12-01" } });
    fireEvent.click(screen.getByRole("radio", { name: /Avery Chen/ }));
    expect(screen.getByLabelText("From")).toHaveValue("2025-09-01");
    expect(screen.getByLabelText("To")).toHaveValue("2025-12-01");

    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "Short Span" } });
    fireEvent.click(await screen.findByRole("radio", { name: /Short Span/ }));
    expect(screen.getByLabelText("From")).toHaveValue("2020-01-15");
    expect(screen.getByLabelText("To")).toHaveValue("2020-02-15");
  });

  it("leaves the pickers empty when message dates are missing", async () => {
    const { onContinue } = renderPicker();
    await ready();
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "Riley Chen" } });
    fireEvent.click(await screen.findByRole("radio", { name: /Riley Chen/ }));
    expect(screen.getByText(/Message dates are not available for this conversation/)).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("");
    expect(screen.getByLabelText("To")).toHaveValue("");
    expect(screen.getByLabelText("From")).not.toHaveAttribute("min");
    expect(screen.getByLabelText("To")).not.toHaveAttribute("max");
    expect(screen.getByRole("button", { name: "Reset to full range" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "riley", dateFrom: "", dateTo: "" }));
  });

  it("shows the API messages for an inverted range and a range with no overlap", async () => {
    const { onContinue } = renderPicker();
    await ready();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2025-08-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("date_from must be on or before date_to.");
    expect(onContinue).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1999-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "1999-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The date range does not overlap this conversation. Messages run from 2025-08-04 to 2026-02-01 (inclusive, local dates).",
    );
    expect(onContinue).not.toHaveBeenCalled();
  });
});

describe("conversation list paging", () => {
  it("pages with previous, next, a page count, and a page size", async () => {
    const { fetchConversations } = renderPicker();
    await ready();
    const list = screen.getByRole("region", { name: "Conversation list" });
    expect(list).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Page 1 of 6. 60 conversations.");
    expect(screen.getByText("Group chats are not supported.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Page 2 of 6/)).toBeInTheDocument();
    expect(fetchConversations).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10, q: "" }));
    expect(screen.queryByRole("radio", { name: /Demo conversation/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2025-08-04");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText(/Page 1 of 6/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Demo conversation/ })).toBeChecked();

    fireEvent.change(screen.getByLabelText("Conversations per page"), { target: { value: "25" } });
    expect(await screen.findByText(/Page 1 of 3/)).toBeInTheDocument();
    expect(fetchConversations).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25, offset: 0 }));
  });

  it("filters by name or handle and shows an empty search state", async () => {
    renderPicker();
    await ready();
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "bob.smith" } });
    expect(await screen.findByRole("radio", { name: /Bob Smith/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 conversation matches.");
    expect(screen.queryByRole("radio", { name: /Demo conversation/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "zzzz-no-match" } });
    expect(await screen.findAllByText("No conversations match.")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("No conversations match.");
  });

  it("waits to search until the typed query settles", async () => {
    const fetchConversations = vi.fn(serverFetch);
    renderPicker(fetchConversations, 300);
    await ready();
    const calls = fetchConversations.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "Bob" } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchConversations.mock.calls.length).toBe(calls);
    expect(await screen.findByRole("radio", { name: /Bob Smith/ })).toBeInTheDocument();
    expect(fetchConversations).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Bob", offset: 0 }));
  });

  it("pages and filters on the client when the response has no total", async () => {
    const fetchConversations = vi.fn(
      async (): Promise<ConversationsFetch> => ({
        body: {
          conversations: MOCK_CATALOG.map((item) => toWire(item)),
          chat_db: { available: true, error: null },
        },
        totalHeader: null,
      }),
    );
    renderPicker(fetchConversations);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Page 2 of 6/)).toBeInTheDocument();
    const expected = MOCK_CATALOG.slice(10, 20).find((item) => item.supported);
    expect(expected).toBeTruthy();
    expect(screen.getByRole("radio", { name: new RegExp(expected?.label ?? "missing") })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Demo conversation/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2025-08-04");

    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "Riley" } });
    expect(await screen.findByRole("radio", { name: /Riley Chen/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Bob Smith/ })).not.toBeInTheDocument();
    expect(fetchConversations.mock.calls.length).toBeGreaterThan(1);
    const lastBody = fetchConversations.mock.results.at(-1);
    expect(lastBody).toBeTruthy();
  });
});

describe("conversation adapter", () => {
  it("maps the wire fields and keeps a server page when total is present", () => {
    const demo = MOCK_CATALOG[0];
    const wire = toWire(demo);
    expect(wire).not.toHaveProperty("handles");
    expect(wire[conversationFields.firstMessageDate]).toBe("2025-08-04");
    expect(wire[conversationFields.lastMessageDate]).toBe("2026-02-01");
    expect(wire[conversationFields.messageCount]).toBe(4259);
    expect(mapConversation(wire)).toMatchObject({
      id: "demo",
      first_message_date: "2025-08-04",
      last_message_date: "2026-02-01",
      message_count: 4259,
      latest_date: "2026-02-01T13:48:05-08:00",
    });
    expect(MOCK_CATALOG).toHaveLength(60);
    expect(MOCK_CATALOG.filter((item) => item.first_message_date == null)).toHaveLength(1);

    const headerOnly = interpretConversationsResponse(
      { conversations: [wire], chat_db: { available: true, error: null } },
      { limit: 10, offset: 0, q: "" },
      "60",
    );
    expect(headerOnly.paging).toBe("server");
    expect(headerOnly.total).toBe(60);
    expect(headerOnly.conversations).toHaveLength(1);
  });

  it("serves limit, offset, q, and falls back when total is omitted", async () => {
    const first = await mockApi.getConversations({ limit: 10, offset: 0, q: "" });
    const page = interpretConversationsResponse(first.body, { limit: 10, offset: 0, q: "" }, first.totalHeader);
    expect(page.paging).toBe("server");
    expect(page.total).toBe(60);
    expect(page.conversations[0]?.id).toBe("demo");
    expect(first.totalHeader).toBe("60");

    const handle = await mockApi.getConversations({ limit: 10, offset: 0, q: "+15550100" });
    const bob = interpretConversationsResponse(handle.body, { limit: 10, offset: 0, q: "+15550100" }, handle.totalHeader);
    expect(bob.conversations.map((item) => item.id)).toEqual(["1"]);

    await expect(mockApi.getConversations({ limit: 0, offset: 0, q: "" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 422,
    });

    window.history.replaceState(null, "", "/?legacy=1");
    const legacy = await mockApi.getConversations({ limit: 10, offset: 10, q: "Bob" });
    expect(legacy.totalHeader).toBeNull();
    expect(legacy.body).not.toHaveProperty(conversationFields.total);
    const sliced = interpretConversationsResponse(legacy.body, { limit: 10, offset: 0, q: "Bob" }, legacy.totalHeader);
    expect(sliced.paging).toBe("client");
    expect(sliced.conversations.map((item) => item.label)).toEqual(["Bob Smith"]);

    window.history.replaceState(null, "", "/?disk=1");
    const blocked = await mockApi.getConversations({ limit: 10, offset: 0, q: "" });
    const disk = interpretConversationsResponse(blocked.body, { limit: 10, offset: 0, q: "" }, blocked.totalHeader);
    expect(disk.chat_db.available).toBe(false);
    expect(disk.conversations.map((item) => item.id)).toEqual(["demo"]);

    await expect(
      mockApi.createAnalysis({
        conversation_id: "demo",
        llm_opt_in: false,
        mode: "deterministic_only",
        date_from: "2026-02-01",
        date_to: "2025-08-04",
      }),
    ).rejects.toMatchObject({ code: "DATE_RANGE_INVALID", message: "date_from must be on or before date_to." });

    await expect(
      mockApi.createAnalysis({
        conversation_id: "demo",
        llm_opt_in: false,
        mode: "deterministic_only",
        date_from: "1999-01-01",
        date_to: "1999-02-01",
      }),
    ).rejects.toMatchObject({
      code: "DATE_RANGE_OUT_OF_BOUNDS",
      message: expect.stringContaining("2025-08-04"),
    });
  });
});

describe("clamped date range", () => {
  it("shows the requested and applied dates on the report", async () => {
    const report = await mockApi.getReport("sample-clamped");
    render(<ReportView report={report} deleting={false} deleteError={null} trendNote={null} onDelete={vi.fn()} />);
    expect(screen.getByTestId("date-range-clamp")).toHaveTextContent(
      "Your range was adjusted to the dates the conversation covers. Requested Jan 1, 2024 to Dec 31, 2099. Applied Aug 4, 2025 to Feb 1, 2026.",
    );
    const plain = { ...report, run_meta: { ...report.run_meta, date_range_clamped: null } } as Report;
    render(<ReportView report={plain} deleting={false} deleteError={null} trendNote={null} onDelete={vi.fn()} />);
    expect(screen.getAllByTestId("date-range-clamp")).toHaveLength(1);
  });
});
