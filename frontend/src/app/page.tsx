"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";

export default function Home() {
  const [username, setUsername] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!active) {
          return;
        }
        if (response.ok) {
          const data = (await response.json()) as { username: string };
          setUsername(data.username);
        } else {
          setUsername(null);
        }
      })
      .catch(() => {
        if (active) {
          setUsername(null);
        }
      })
      .finally(() => {
        if (active) {
          setIsCheckingAuth(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUsername(null);
  };

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
        Loading workspace...
      </div>
    );
  }

  if (!username) {
    return <LoginForm onLoginSuccess={(loggedInUser) => setUsername(loggedInUser)} />;
  }

  return <KanbanBoard username={username} onLogout={handleLogout} />;
}
