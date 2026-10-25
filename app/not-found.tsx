// 404 page. Also shown when someone opens a page their role doesn't allow, so restricted pages don't reveal they exist.
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold text-white">Not found</h1>
      <p className="text-zinc-400">This conversation does not exist or belongs to another account.</p>
      <Link href="/chat" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
        Back to chat
      </Link>
    </main>
  );
}
