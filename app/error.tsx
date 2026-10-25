"use client";

// Friendly fallback for any unexpected error while rendering a page (instead of a blank screen).
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
      <p className="max-w-md text-zinc-400">
        The page couldn&apos;t load. This is usually a temporary problem with GitHub, the AI provider or the database.
      </p>
      {error.digest && <p className="font-mono text-xs text-zinc-600">Reference: {error.digest}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-zinc-200">
          Home
        </Link>
      </div>
    </main>
  );
}
