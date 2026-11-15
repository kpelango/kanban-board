"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { Workspace } from "@/components/Workspace";
import { SESSION_EXPIRED_EVENT, getMe, logout, type User } from "@/lib/api";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsCheckingAuth(false));

    const handleExpired = () => {
      setUser((current) => {
        if (current) {
          setNotice("Your session ended. Sign in again to continue.");
        }
        return null;
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);

  const handleLogout = async () => {
    await logout().catch(() => null);
    setUser(null);
  };

  if (isCheckingAuth) {
    return <div className="min-h-dvh bg-navy" aria-busy="true" />;
  }

  if (!user) {
    return (
      <AuthScreen
        notice={notice}
        onAuthenticated={(signedIn) => {
          setNotice(null);
          setUser(signedIn);
        }}
      />
    );
  }

  return (
    <Workspace
      key={user.username}
      username={user.username}
      isAdmin={user.isAdmin}
      onLogout={handleLogout}
    />
  );
}
