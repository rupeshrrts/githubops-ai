// Shown instantly while a page loads its data on the server (GitHub, database), so clicks feel responsive.
import { LogoMark } from "@/frontend/components/icons";

export default function Loading() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <LogoMark className="size-10 animate-pulse" />
    </main>
  );
}
