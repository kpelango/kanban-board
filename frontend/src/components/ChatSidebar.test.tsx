import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import { initialData } from "@/test/fixtures";
import { mockFetch } from "@/test/fetchMock";

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary = (id: number, title: string) => ({
  id,
  boardId: 1,
  title,
  updatedAt: "2026-11-14 10:00:00",
});

const renderSidebar = (onBoardUpdate = vi.fn()) =>
  render(
    <ChatSidebar boardId={1} boardName="Roadmap" isOpen onClose={vi.fn()} onBoardUpdate={onBoardUpdate} />
  );

describe("ChatSidebar", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ChatSidebar boardId={1} boardName="Roadmap" isOpen={false} onClose={vi.fn()} onBoardUpdate={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the most recent chat with its messages", async () => {
    mockFetch({
      "GET /api/boards/1/conversations": () => [summary(2, "Sprint plan"), summary(1, "Older")],
      "GET /api/conversations/2": () => ({
        ...summary(2, "Sprint plan"),
        messages: [
          { role: "user", content: "What is next?" },
          { role: "assistant", content: "Ship the beta." },
        ],
      }),
    });
    renderSidebar();
    expect(await screen.findByText("Ship the beta.")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat title")).toHaveValue("Sprint plan");
    expect(screen.getByText("Assistant for Roadmap")).toBeInTheDocument();
  });

  it("creates a chat on first message and applies board updates", async () => {
    const updated = structuredClone(initialData);
    updated.columns[0].title = "Ideas";
    const { calls } = mockFetch({
      "GET /api/boards/1/conversations": () => [],
      "POST /api/boards/1/conversations": () => ({ status: 201, body: summary(5, "New conversation") }),
      "POST /api/conversations/5/messages": () => ({
        reply: "Renamed Backlog to Ideas.",
        board: updated,
        conversation: summary(5, "Rename backlog"),
      }),
    });
    const onBoardUpdate = vi.fn();
    renderSidebar(onBoardUpdate);
    expect(await screen.findByText("Ask about this board or tell it what to change.")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("AI chat input"), "Rename backlog{Enter}");
    expect(await screen.findByText("Renamed Backlog to Ideas.")).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-user")).toHaveTextContent("Rename backlog");
    expect(onBoardUpdate).toHaveBeenCalledWith(updated);
    expect(screen.getByText("Updated the board")).toBeInTheDocument();
    expect(calls.find((c) => c.key === "POST /api/conversations/5/messages")?.body).toEqual({
      message: "Rename backlog",
    });
    expect(screen.getByLabelText("Chat title")).toHaveValue("Rename backlog");
  });

  it("does not mark replies that left the board alone", async () => {
    mockFetch({
      "GET /api/boards/1/conversations": () => [summary(1, "Chat")],
      "GET /api/conversations/1": () => ({ ...summary(1, "Chat"), messages: [] }),
      "POST /api/conversations/1/messages": () => ({
        reply: "You have 8 cards.",
        board: null,
        conversation: summary(1, "Chat"),
      }),
    });
    renderSidebar();
    await waitFor(() => expect(screen.getByLabelText("Chat title")).toHaveValue("Chat"));
    await userEvent.type(screen.getByLabelText("AI chat input"), "How many cards?{Enter}");
    expect(await screen.findByText("You have 8 cards.")).toBeInTheDocument();
    expect(screen.queryByText("Updated the board")).not.toBeInTheDocument();
  });

  it("shows an error when the assistant fails", async () => {
    mockFetch({
      "GET /api/boards/1/conversations": () => [summary(1, "Chat")],
      "GET /api/conversations/1": () => ({ ...summary(1, "Chat"), messages: [] }),
      "POST /api/conversations/1/messages": () => ({
        status: 502,
        body: { detail: "OpenRouter returned status 429" },
      }),
    });
    const onBoardUpdate = vi.fn();
    renderSidebar(onBoardUpdate);
    await waitFor(() => expect(screen.getByLabelText("Chat title")).toHaveValue("Chat"));
    await userEvent.type(screen.getByLabelText("AI chat input"), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("OpenRouter returned status 429");
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("switches between chats, starts new ones, and deletes them", async () => {
    mockFetch({
      "GET /api/boards/1/conversations": () => [summary(2, "Second"), summary(1, "First")],
      "GET /api/conversations/2": () => ({ ...summary(2, "Second"), messages: [{ role: "user", content: "two" }] }),
      "GET /api/conversations/1": () => ({ ...summary(1, "First"), messages: [{ role: "user", content: "one" }] }),
      "DELETE /api/conversations/1": () => ({ status: 204 }),
    });
    renderSidebar();
    expect(await screen.findByText("two")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Chats (2)" }));
    const list = screen.getByRole("list", { name: "Chats" });
    await userEvent.click(within(list).getByText("First"));
    expect(await screen.findByText("one")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Chats (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete chat First" }));
    expect(screen.getByRole("button", { name: "Chats (1)" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Chats" })).queryByText("First")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("heading", { name: "New chat" })).toBeInTheDocument();
  });

  it("renames the active chat", async () => {
    const { calls } = mockFetch({
      "GET /api/boards/1/conversations": () => [summary(1, "Chat")],
      "GET /api/conversations/1": () => ({ ...summary(1, "Chat"), messages: [] }),
      "PATCH /api/conversations/1": (body) => summary(1, (body as { name: string }).name),
    });
    renderSidebar();
    const title = await screen.findByLabelText("Chat title");
    await waitFor(() => expect(title).toHaveValue("Chat"));
    await userEvent.clear(title);
    await userEvent.type(title, "Planning{Enter}");
    await waitFor(() => expect(calls.some((c) => c.key === "PATCH /api/conversations/1")).toBe(true));
    expect(screen.getByLabelText("Chat title")).toHaveValue("Planning");
  });
});
