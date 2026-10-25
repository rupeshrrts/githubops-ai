// Removes ?error=... from the address after the sign-in error note has been shown once,
// so refreshing the page or reopening an old tab doesn't show a stale error again.
"use client";

import { useEffect } from "react";

export function ClearUrlError() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error")) return;
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  return null;
}
