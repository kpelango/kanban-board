import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersDialog } from "@/components/UsersDialog";
import { mockFetch } from "@/test/fetchMock";

const users = () => [
  { id: 1, username: "user", isAdmin: true, createdAt: "2026-11-01T09:00:00+00:00", boardCount: 2 },
  { id: 2, username: "bob", isAdmin: false, createdAt: "2026-11-02T09:00:00+00:00", boardCount: 1 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersDialog", () => {
  it("lists users without actions on your own account", async () => {
    mockFetch({ "GET /api/admin/users": users });
    render(<UsersDialog currentUsername="user" onClose={vi.fn()} />);
    const me = await screen.findByTestId("user-user");
    expect(within(me).getByText("Admin")).toBeInTheDocument();
    expect(within(me).getByText("(you)")).toBeInTheDocument();
    expect(within(me).getByText(/2 boards/)).toBeInTheDocument();
    expect(within(me).queryByRole("button")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("user-bob")).getByText(/1 board,/)).toBeInTheDocument();
  });

  it("grants admin rights", async () => {
    const { calls } = mockFetch({
      "GET /api/admin/users": users,
      "PATCH /api/admin/users/2": () => ({ ...users()[1], isAdmin: true }),
    });
    render(<UsersDialog currentUsername="user" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Make admin bob" }));
    expect(await screen.findByRole("status")).toHaveTextContent("bob is now an admin.");
    expect(within(screen.getByTestId("user-bob")).getByText("Admin")).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ isAdmin: true });
  });

  it("resets a password after validating it", async () => {
    const { calls } = mockFetch({
      "GET /api/admin/users": users,
      "PUT /api/admin/users/2/password": () => ({ status: "password_reset" }),
    });
    render(<UsersDialog currentUsername="user" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Reset password for bob" }));
    const input = screen.getByLabelText("New password for bob");
    await userEvent.type(input, "short");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");

    await userEvent.clear(input);
    await userEvent.type(input, "new-password");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Password reset for bob.");
    expect(calls.at(-1)?.body).toEqual({ newPassword: "new-password" });
  });

  it("deletes a user after confirming", async () => {
    mockFetch({
      "GET /api/admin/users": users,
      "DELETE /api/admin/users/2": () => ({ status: 204 }),
    });
    render(<UsersDialog currentUsername="user" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete bob" }));
    expect(screen.getByText(/Delete bob with all their boards/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Deleted bob.");
    expect(screen.queryByTestId("user-bob")).not.toBeInTheDocument();
  });

  it("shows server errors", async () => {
    mockFetch({
      "GET /api/admin/users": users,
      "PATCH /api/admin/users/2": () => ({ status: 403, body: { detail: "Admins only" } }),
    });
    render(<UsersDialog currentUsername="user" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Make admin bob" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Admins only");
  });
});
