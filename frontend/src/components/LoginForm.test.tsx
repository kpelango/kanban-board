import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import Home from "@/app/page";

describe("Authentication and LoginForm flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the login screen when unauthenticated", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
      })
    );

    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: /sign in to kanban studio/i })
    ).toBeInTheDocument();
  });

  it("displays an error when login fails with invalid credentials", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Invalid username or password" }), {
        status: 401,
      })
    );

    render(<Home />);

    const usernameInput = await screen.findByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await userEvent.type(usernameInput, "user");
    await userEvent.type(passwordInput, "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid username or password/i
    );
  });

  it("transitions to the Kanban board after login and returns to login on logout", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Not authenticated" }), {
        status: 401,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ username: "user" }), {
        status: 200,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ columns: [], cards: {} }), {
        status: 500,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "logged_out" }), {
        status: 200,
      })
    );

    render(<Home />);

    const usernameInput = await screen.findByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await userEvent.type(usernameInput, "user");
    await userEvent.type(passwordInput, "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
    expect(screen.getByText(/signed in as user/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /sign in to kanban studio/i })
      ).toBeInTheDocument();
    });
  });
});
