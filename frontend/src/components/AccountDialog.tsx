"use client";

import { useState, type FormEvent } from "react";
import { errorText, changePassword, deleteAccount } from "@/lib/api";
import {
  ErrorText,
  Modal,
  buttonDanger,
  buttonPrimary,
  inputClass,
  labelClass,
} from "@/components/ui";

type AccountDialogProps = {
  username: string;
  onClose: () => void;
  onAccountDeleted: () => void;
};


export const AccountDialog = ({ username, onClose, onAccountDeleted }: AccountDialogProps) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setPasswordStatus({ ok: false, text: "New passwords need at least 8 characters." });
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordStatus({ ok: true, text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordStatus({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await deleteAccount(deletePassword);
      onAccountDeleted();
    } catch (err) {
      setDeleteError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Account settings" onClose={onClose}>
      <p className="text-[15px] text-ink-soft">
        Signed in as <strong className="text-navy">{username}</strong>
      </p>

      <form onSubmit={handleChangePassword} className="mt-5 space-y-3">
        <h3 className="font-display text-base font-semibold text-navy">Change password</h3>
        <div>
          <label htmlFor="current-password" className={labelClass}>
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="new-password" className={labelClass}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        {passwordStatus &&
          (passwordStatus.ok ? (
            <p role="status" className="text-sm font-bold text-success">
              {passwordStatus.text}
            </p>
          ) : (
            <ErrorText>{passwordStatus.text}</ErrorText>
          ))}
        <button type="submit" disabled={busy} className={buttonPrimary}>
          Change password
        </button>
      </form>

      <form onSubmit={handleDelete} className="mt-6 space-y-3 border-t border-stroke pt-5">
        <h3 className="font-display text-base font-semibold text-danger">Delete account</h3>
        <p className="text-sm text-ink-soft">
          Removes your account, every board, and all AI chats. This cannot be undone.
        </p>
        <div>
          <label htmlFor="delete-password" className={labelClass}>
            Confirm with your password
          </label>
          <input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
            required
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        {deleteError && <ErrorText>{deleteError}</ErrorText>}
        <button type="submit" disabled={busy || !deletePassword} className={buttonDanger}>
          Delete account
        </button>
      </form>
    </Modal>
  );
};
