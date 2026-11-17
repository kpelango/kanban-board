"use client";

import { useState, type FormEvent } from "react";
import { errorText, login, register, tryDemo, type User } from "@/lib/api";
import {
  BrandMark,
  ErrorText,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  labelClass,
} from "@/components/ui";

type AuthScreenProps = {
  notice?: string | null;
  onAuthenticated: (user: User) => void;
};

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;

const validateRegistration = (username: string, password: string) => {
  if (!USERNAME_PATTERN.test(username)) {
    return "Usernames are 3 to 32 characters: letters, numbers, dots, dashes, or underscores.";
  }
  if (password.length < 8) {
    return "Passwords need at least 8 characters.";
  }
  return null;
};

// The board's flow rail in miniature: five stages on one yellow line, work thinning toward Done
const MiniBoard = () => (
  <div aria-hidden="true">
    <div className="grid grid-cols-5 gap-2">
      {[1, 2, 3, 4, 5].map((stage) => (
        <span key={stage} className="font-numeral text-4xl leading-none font-bold text-white">
          {stage}
        </span>
      ))}
    </div>
    <div className="mt-2 h-[3px] bg-yellow" />
    <div className="mt-3 grid grid-cols-5 items-start gap-2">
      {[3, 2, 2, 1, 2].map((count, lane) => (
        <div key={lane} className="space-y-2">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="relative rounded-[4px] bg-white/90 p-2">
              {(lane + index) % 3 === 0 && (
                <span className="absolute -top-px left-2 h-1 w-5 rounded-b-sm bg-purple" />
              )}
              <div className="h-1.5 w-4/5 rounded-full bg-navy/70" />
              <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-navy/20" />
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const AuthScreen = ({ notice, onAuthenticated }: AuthScreenProps) => {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"form" | "demo" | null>(null);
  const isSubmitting = pending === "form";
  const isRegister = mode === "register";

  const switchMode = () => {
    setMode(isRegister ? "signin" : "register");
    setError(null);
  };

  const run = async (kind: "form" | "demo", action: () => Promise<User>) => {
    setError(null);
    setPending(kind);
    try {
      onAuthenticated(await action());
    } catch (err) {
      setError(errorText(err, "Unable to reach the server. Try again."));
    } finally {
      setPending(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = username.trim();
    const validationError = isRegister ? validateRegistration(trimmed, password) : null;
    if (validationError) {
      setError(validationError);
      return;
    }
    await run("form", () => (isRegister ? register(trimmed, password) : login(trimmed, password)));
  };

  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:flex-row">
      <aside className="flex flex-col justify-between gap-10 bg-navy px-6 py-6 text-white lg:w-[44%] lg:px-14 lg:py-14">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <BrandMark className="h-4 w-1.5" />
          Kanban Studio
        </p>
        <div className="hidden max-w-md lg:block">
          <MiniBoard />
          <p className="mt-12 font-display text-[44px] leading-[1.05] font-semibold tracking-[-0.01em]">
            Every project, one wall of cards.
          </p>
          <p className="mt-4 text-[17px] leading-relaxed text-white/70">
            Keep a board per project, move work across five stages, and ask the assistant to
            reshuffle cards for you.
          </p>
        </div>
        <span className="hidden text-sm text-white/50 lg:block">
          A public demo. Keep private information off your boards.
        </span>
      </aside>

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center">
        <section className="w-full max-w-sm">
          {notice && (
            <p
              role="status"
              className="mb-6 rounded-md border border-yellow/60 bg-yellow/15 px-3 py-2 text-sm text-ink"
            >
              {notice}
            </p>
          )}
          <h1 className="font-display text-[30px] leading-tight font-semibold text-navy">
            {isRegister ? "Create your account" : "Sign in to Kanban Studio"}
          </h1>
          <p className="mt-2 text-[15px] text-muted">
            {isRegister
              ? "You get a starter board you can rename or replace."
              : "Use your username and password to open your boards."}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div>
              <label htmlFor="auth-username" className={labelClass}>
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="auth-password" className={labelClass}>
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                className={`mt-1.5 ${inputClass}`}
              />
              {isRegister && (
                <p className="mt-1.5 text-sm text-muted">At least 8 characters.</p>
              )}
            </div>

            {error && <ErrorText>{error}</ErrorText>}

            <button type="submit" disabled={pending !== null} className={`${buttonPrimary} w-full py-2.5`}>
              {isRegister
                ? isSubmitting
                  ? "Creating account..."
                  : "Create account"
                : isSubmitting
                  ? "Signing in..."
                  : "Sign in"}
            </button>
          </form>

          <div className="mt-8 border-t border-stroke pt-6">
            <button
              type="button"
              onClick={() => run("demo", tryDemo)}
              disabled={pending !== null}
              aria-describedby="demo-hint"
              className={`${buttonSecondary} w-full py-2.5`}
            >
              {pending === "demo" ? "Starting demo..." : "Try the demo"}
            </button>
            <p id="demo-hint" className="mt-2 text-sm text-muted">
              No sign-up needed. Guest boards are deleted after 24 hours.
            </p>
          </div>

          <p className="mt-6 text-[15px] text-ink-soft">
            {isRegister ? "Already have an account? " : "New here? "}
            <button type="button" onClick={switchMode} className="font-bold text-link hover:underline">
              {isRegister ? "Sign in" : "Create an account"}
            </button>
          </p>
        </section>
      </main>
    </div>
  );
};
