// Settings → GitHub connection: "Disconnect GitHub", and the optional box to paste a key the user created on GitHub.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buttonStyles, inputStyles } from "@/frontend/components/ui";

/** Paste a key; the server checks it with GitHub and keeps it only in this browser. */
export function GithubKeyForm({ label = "Save key" }: { label?: string }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/account/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save the key.");
      return;
    }
    setKey("");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap gap-2">
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="ghp_...  or  github_pat_..."
        aria-label="GitHub key"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        className={`${inputStyles} min-w-0 flex-1 font-mono`}
      />
      <button type="submit" disabled={busy || !key.trim()} className={buttonStyles.primary}>
        {busy ? "Checking with GitHub..." : label}
      </button>
      {error && <p className="w-full text-sm text-red-300">{error}</p>}
    </form>
  );
}

export function DisconnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (
      !confirm(
        "Disconnect GitHub? This withdraws the app's access at GitHub and removes it from this browser. Your chats and audit log are kept, and you can connect again with one click.",
      )
    ) {
      return;
    }
    setBusy(true);
    await fetch("/api/account/disconnect", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button type="button" onClick={disconnect} disabled={busy} className={buttonStyles.danger}>
      {busy ? "Disconnecting..." : "Disconnect GitHub"}
    </button>
  );
}
