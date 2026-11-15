"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserAdmin,
  type UserSummary,
  errorText,
} from "@/lib/api";
import {
  ErrorText,
  Modal,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/components/ui";
import { formatDate } from "@/lib/format";

type UsersDialogProps = {
  currentUsername: string;
  onClose: () => void;
};

type Pending = { userId: number; action: "reset" | "delete" } | null;

export const UsersDialog = ({ currentUsername, onClose }: UsersDialogProps) => {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setError("Could not load users."));
  }, []);

  const run = async (action: () => Promise<void>, success: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setPending(null);
      setNewPassword("");
    } catch (err) {
      setError(errorText(err));
    }
  };

  const toggleAdmin = (user: UserSummary) =>
    run(async () => {
      const updated = await setUserAdmin(user.id, !user.isAdmin);
      setUsers((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
    }, `${user.username} ${user.isAdmin ? "is no longer an admin" : "is now an admin"}.`);

  const submitReset = (event: FormEvent<HTMLFormElement>, user: UserSummary) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("New passwords need at least 8 characters.");
      return;
    }
    void run(() => resetUserPassword(user.id, newPassword), `Password reset for ${user.username}.`);
  };

  const confirmDelete = (user: UserSummary) =>
    run(async () => {
      await deleteUser(user.id);
      setUsers((prev) => prev?.filter((u) => u.id !== user.id) ?? null);
    }, `Deleted ${user.username}.`);

  return (
    <Modal title="Manage users" onClose={onClose} wide>
      {notice && (
        <p role="status" className="mb-3 text-sm font-bold text-success">
          {notice}
        </p>
      )}
      {error && (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {users === null && !error && <p className="text-muted">Loading users...</p>}
      <ul className="divide-y divide-stroke" aria-label="Users">
        {users?.map((user) => {
          const isSelf = user.username === currentUsername;
          const isPending = pending?.userId === user.id;
          return (
            <li key={user.id} className="py-3" data-testid={`user-${user.username}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-bold text-navy">
                    <span className="truncate">{user.username}</span>
                    {user.isAdmin && (
                      <span className="rounded bg-yellow/25 px-1.5 py-0.5 text-xs text-yellow-text">Admin</span>
                    )}
                    {isSelf && <span className="text-sm font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {user.boardCount} {user.boardCount === 1 ? "board" : "boards"}, joined{" "}
                    {formatDate(user.createdAt)}
                  </p>
                </div>
                {!isSelf && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleAdmin(user)}
                      className={buttonSecondary}
                      aria-label={`${user.isAdmin ? "Remove admin from" : "Make admin"} ${user.username}`}
                    >
                      {user.isAdmin ? "Remove admin" : "Make admin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPending({ userId: user.id, action: "reset" });
                        setNewPassword("");
                        setError(null);
                      }}
                      className={buttonSecondary}
                      aria-label={`Reset password for ${user.username}`}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending({ userId: user.id, action: "delete" })}
                      className={buttonDanger}
                      aria-label={`Delete ${user.username}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {isPending && pending.action === "reset" && (
                <form onSubmit={(event) => submitReset(event, user)} className="mt-3 flex flex-wrap gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="New password (8+ characters)"
                    aria-label={`New password for ${user.username}`}
                    autoComplete="new-password"
                    autoFocus
                    className={`${inputClass} min-w-0 flex-1`}
                  />
                  <button type="submit" className={buttonPrimary}>
                    Set password
                  </button>
                  <button type="button" onClick={() => setPending(null)} className={buttonSecondary}>
                    Cancel
                  </button>
                </form>
              )}

              {isPending && pending.action === "delete" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-danger-soft p-3">
                  <p className="flex-1 text-sm text-danger">
                    Delete {user.username} with all their boards and chats? This cannot be undone.
                  </p>
                  <button type="button" onClick={() => void confirmDelete(user)} className={buttonDanger}>
                    Delete user
                  </button>
                  <button type="button" onClick={() => setPending(null)} className={buttonSecondary}>
                    Keep
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};
