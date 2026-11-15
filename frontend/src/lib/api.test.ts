import { SESSION_EXPIRED_EVENT, listBoards, login, saveBoard } from "@/lib/api";
import { initialData } from "@/test/fixtures";
import { mockFetch } from "@/test/fetchMock";

afterEach(() => {
  vi.unstubAllGlobals();
});

const listenForExpiry = () => {
  const handler = vi.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, handler);
  return {
    handler,
    stop: () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler),
  };
};

describe("api", () => {
  it("signals an expired session on 401 from data endpoints", async () => {
    mockFetch({ "GET /api/boards": () => ({ status: 401, body: { detail: "Invalid session" } }) });
    const { handler, stop } = listenForExpiry();
    await expect(listBoards()).rejects.toThrow("Invalid session");
    expect(handler).toHaveBeenCalledTimes(1);
    stop();
  });

  it("rejects a failed sign-in with the server's message", async () => {
    mockFetch({
      "POST /api/auth/login": () => ({ status: 401, body: { detail: "Invalid username or password" } }),
    });
    await expect(login("user", "nope")).rejects.toThrow("Invalid username or password");
  });

  it("turns validation errors into readable messages", async () => {
    mockFetch({
      "PUT /api/boards/1": () => ({
        status: 422,
        body: { detail: [{ msg: "Value error, Card 'x' appears multiple times across columns" }] },
      }),
    });
    await expect(saveBoard(1, initialData)).rejects.toThrow(
      "Card 'x' appears multiple times across columns"
    );
  });
});
