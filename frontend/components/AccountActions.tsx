// "Reconnect" and "Disconnect GitHub" buttons on the Settings page.
"use client";

import { useState } from "react";

import { signInWithGitHub } from "@/backend/actions";
import { GitHubIcon } from "@/frontend/components/icons";
import { buttonStyles } from "@/frontend/components/ui";

export function AccountActions() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (
      !confirm(
        "Disconnect GitHub? This revokes the app's access at GitHub, deletes the stored token and signs you out everywhere. Your conversations and audit log are kept.",
      )
    ) {
      return;
    }
    setBusy(true);
    const response = await fetch("/api/account/disconnect", { method: "POST" });
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error ?? "Could not disconnect.");
      setBusy(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={signInWithGitHub}>
        <button type="submit" className={buttonStyles.secondary}>
          <GitHubIcon className="size-4" /> Reconnect / refresh access
        </button>
      </form>
      <button type="button" onClick={disconnect} disabled={busy} className={buttonStyles.danger}>
        {busy ? "Disconnecting..." : "Disconnect GitHub"}
      </button>
      {error && <p className="w-full text-sm text-red-300">{error}</p>}
    </div>
  );
}
