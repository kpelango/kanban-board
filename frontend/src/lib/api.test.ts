import { SESSION_EXPIRED_EVENT, listBoards, login, saveBoard, tryDemo } from "@/lib/api";
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

  it("starts a guest session for the demo", async () => {
    const guest = { username: "guest-ab12cd", isAdmin: false, isGuest: true };
    const { calls } = mockFetch({ "POST /api/auth/guest": () => ({ status: 201, body: guest }) });
    await expect(tryDemo()).resolves.toEqual(guest);
    expect(calls).toEqual([{ key: "POST /api/auth/guest", body: undefined }]);
  });

  it("explains a failed demo start when the server gives no reason", async () => {
    mockFetch({ "POST /api/auth/guest": () => ({ status: 500, body: {} }) });
    await expect(tryDemo()).rejects.toThrow("Could not start the demo. Try again.");
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
