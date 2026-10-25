// Root layout: wraps every page with the HTML shell, global styles and the page-title template.
import type { Metadata, Viewport } from "next";

import "@/frontend/styles/globals.css";

export const metadata: Metadata = {
  title: { default: "GitHubOps AI", template: "%s · GitHubOps AI" },
  description: "Talk to GitHub in plain English or Hinglish. Reads run instantly; every write waits for your approval.",
};

export const viewport: Viewport = { themeColor: "#13090b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
