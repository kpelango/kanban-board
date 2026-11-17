import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthScreen } from "@/components/AuthScreen";
import { mockFetch } from "@/test/fetchMock";

afterEach(() => {
  vi.unstubAllGlobals();
});

const fill = async (username: string, password: string) => {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
};

describe("AuthScreen", () => {
  it("signs in with valid credentials", async () => {
    const { calls } = mockFetch({ "POST /api/auth/login": () => ({ username: "user", isAdmin: true, isGuest: false }) });
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await fill(" user ", "password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onAuthenticated).toHaveBeenCalledWith({ username: "user", isAdmin: true, isGuest: false });
    expect(calls[0].body).toEqual({ username: "user", password: "password" });
  });

  it("shows the server error for invalid credentials", async () => {
    mockFetch({
      "POST /api/auth/login": () => ({ status: 401, body: { detail: "Invalid username or password" } }),
    });
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await fill("user", "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password");
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("starts a guest demo without a username or password", async () => {
    const guest = { username: "guest-ab12cd", isAdmin: false, isGuest: true };
    const { calls } = mockFetch({ "POST /api/auth/guest": () => ({ status: 201, body: guest }) });
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    expect(screen.getByRole("button", { name: "Try the demo" })).toHaveAccessibleDescription(
      "No sign-up needed. Guest boards are deleted after 24 hours."
    );
    await userEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(onAuthenticated).toHaveBeenCalledWith(guest);
    expect(calls.map((call) => call.key)).toEqual(["POST /api/auth/guest"]);
  });

  it("offers the demo on the registration screen too", async () => {
    mockFetch({});
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeInTheDocument();
  });

  it("shows the server error when the demo cannot start", async () => {
    mockFetch({
      "POST /api/auth/guest": () => ({ status: 503, body: { detail: "Database unavailable" } }),
    });
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await userEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByRole("button", { name: "Try the demo" })).toBeEnabled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("shows a notice passed in by the app", () => {
    render(<AuthScreen notice="Your session ended. Sign in again to continue." onAuthenticated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Your session ended");
  });

  it("validates registration input before calling the server", async () => {
    const { fetchMock } = mockFetch({});
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();

    await fill("a b", "password1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Usernames are 3 to 32 characters");

    await userEvent.clear(screen.getByLabelText("Username"));
    await userEvent.clear(screen.getByLabelText("Password"));
    await fill("alice", "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers a new account", async () => {
    mockFetch({ "POST /api/auth/register": () => ({ status: 201, body: { username: "alice", isAdmin: false, isGuest: false } }) });
    const onAuthenticated = vi.fn();
    render(<AuthScreen onAuthenticated={onAuthenticated} />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill("alice", "password1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(onAuthenticated).toHaveBeenCalledWith({ username: "alice", isAdmin: false, isGuest: false });
  });

  it("reports a taken username", async () => {
    mockFetch({
      "POST /api/auth/register": () => ({ status: 409, body: { detail: "Username is already taken" } }),
    });
    render(<AuthScreen onAuthenticated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill("user", "password1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Username is already taken");
  });
});
