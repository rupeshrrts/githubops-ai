// /demo: try the assistant without signing in, on a pretend GitHub account (see backend/demo/).
// Returning visitors (same browser, within 24 hours) continue their own demo.
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { seedSandbox, viewOf } from "@/backend/demo/sandbox";
import { DEMO_COOKIE, demoAgent, demoEnabled, demoSnapshot } from "@/backend/demo/session";
import { getDemoSession } from "@/backend/demo/store";
import { DemoWorkspace } from "@/frontend/components/DemoWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live demo" };

export default async function DemoPage() {
  if (!demoEnabled()) notFound();
  if (!process.env.DATABASE_URL || !process.env.NVIDIA_API_KEY) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 text-center text-zinc-300">
        The demo needs DATABASE_URL and NVIDIA_API_KEY to be configured.
      </main>
    );
  }

  const session = await getDemoSession((await cookies()).get(DEMO_COOKIE)?.value);
  if (!session) {
    return <DemoWorkspace initial={null} initialSandbox={viewOf(seedSandbox())} />;
  }
  const state = await (await demoAgent(session)).state(session.id);
  return <DemoWorkspace initial={demoSnapshot(session, state)} initialSandbox={viewOf(session.sandbox)} />;
}
