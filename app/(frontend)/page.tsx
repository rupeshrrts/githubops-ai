// Landing page (/): the public product page with "Sign in with GitHub". Signed-in users go straight to /chat.
import Link from "next/link";
import { redirect } from "next/navigation";

import { signInWithGitHub } from "@/backend/actions";
import { ClearUrlError } from "@/frontend/components/ClearUrlError";
import {
  PlayIcon,
  BoltIcon,
  ChatIcon,
  CheckIcon,
  GitHubIcon,
  KeyIcon,
  ListIcon,
  LogoMark,
  RepoIcon,
  ShieldIcon,
  UsersIcon,
} from "@/frontend/components/icons";
import { ProductPreview } from "@/frontend/components/ProductPreview";
import { currentUser, missingConfig } from "@/backend/session";

export const dynamic = "force-dynamic";

const REPO_URL = "https://github.com/rupeshrrts/githubops-ai";

const FEATURES = [
  { icon: ChatIcon, title: "Natural-language control", body: "Repos, issues, PRs, branches, files, Actions, releases, orgs: anything in the GitHub API, in English or Hinglish." },
  { icon: ShieldIcon, title: "Approval workflows", body: "Writes wait for your click. Sensitive actions (merge, visibility, delete) go to an admin review queue first." },
  { icon: UsersIcon, title: "Roles & permissions", body: "Viewer, member, maintainer, admin, plus per-user exceptions. The AI only sees the tools a user is allowed to use." },
  { icon: ListIcon, title: "Complete audit trail", body: "Every proposal, approval, rejection and admin change, with who decided and what GitHub answered." },
  { icon: KeyIcon, title: "Your access stays with you", body: "One approval connects GitHub. That access is kept encrypted in your own browser, never in the database, and you can disconnect in one click." },
  { icon: RepoIcon, title: "Repos & Actions dashboard", body: "Synced repository list, CI runs, open PRs and issues, and one-click workflow runs per repository." },
];

const SAFETY = [
  "The AI can propose changes but never run them on its own",
  "Deletes, merges and visibility changes are flagged as sensitive",
  "Approval rules are enforced on the server, not just in the UI",
  "Your GitHub access stays in your browser and is never saved on the server",
  "API calls are locked to api.github.com, so your access can't be sent elsewhere",
  "Per-user daily limits keep a public deployment affordable",
  "Row Level Security keeps Supabase's public API out of every table",
];

const STEPS = [
  ["Sign in", "One click with GitHub and one approval. Your access stays in your browser."],
  ["Ask", "“Create a branch feature/login in my api repo.”"],
  ["Review", "An approval card shows exactly what will change. Edit, approve or reject."],
  ["Audited", "It runs with your own GitHub permissions and lands in the audit log."],
];

function SignInButton({ disabled, large }: { disabled: boolean; large?: boolean }) {
  return (
    <form action={signInWithGitHub}>
      <button
        type="submit"
        disabled={disabled}
        className={`inline-flex items-center gap-2.5 rounded-xl bg-white font-semibold text-ink-900 shadow-lg shadow-rose-950/40 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 ${
          large ? "px-6 py-3" : "px-4 py-2 text-sm"
        }`}
      >
        <GitHubIcon className={large ? "size-5" : "size-4"} /> Sign in with GitHub
      </button>
    </form>
  );
}

// Auth.js error codes (sent as /?error=...) explained for users.
const SIGN_IN_ERRORS: Record<string, string> = {
  AccessDenied: "GitHub access was not granted. Click Sign in with GitHub and choose Authorize to continue.",
  Verification: "That sign-in link has expired. Please sign in again.",
  OAuthAccountNotLinked: "This GitHub account is linked to a different user here. Sign in with the account you used before.",
};
const DEFAULT_SIGN_IN_ERROR =
  "Sign-in didn't finish, usually because it took more than 15 minutes or was finished in a different browser tab or window. Please click Sign in with GitHub again and complete it in the same window.";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const missing = missingConfig();
  const { error: signInError } = await searchParams;

  // Signed-in users go straight to the app. If the database is unreachable, keep the landing
  // page up and explain the problem instead of crashing.
  let signedIn = false;
  let databaseDown = false;
  try {
    signedIn = (await currentUser()) !== null;
  } catch (error) {
    console.error("Landing page could not load the session:", error);
    databaseDown = true;
  }
  if (signedIn) redirect("/chat"); // outside try: redirect() works by throwing
  const blocked = missing.length > 0 || databaseDown;

  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(ellipse_at_top,rgba(225,29,72,0.28),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5 font-semibold tracking-tight">
          <LogoMark /> GitHubOps AI
        </div>
        <nav className="flex items-center gap-5 text-sm text-zinc-300">
          <a href="#features" className="hidden hover:text-white sm:block">Features</a>
          <a href="#security" className="hidden hover:text-white sm:block">Security</a>
          <Link href="/demo" className="hidden hover:text-white sm:block">Demo</Link>
          <a href={REPO_URL} className="flex items-center gap-1.5 hover:text-white">
            <GitHubIcon className="size-4" /> <span className="hidden sm:inline">Source</span>
          </a>
          <SignInButton disabled={blocked} />
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
        <div className="min-w-0">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-ink-850/70 px-3 py-1 text-xs text-zinc-300">
            <span className="size-1.5 rounded-full bg-emerald-400" /> Open source · AI agent with human approval
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Run GitHub by chat.
            <br />
            <span className="bg-gradient-to-r from-rose-300 to-orange-200 bg-clip-text text-transparent">Approve every change.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-zinc-300">
            A team portal where an AI agent operates your repositories, issues, pull requests and Actions, with roles,
            admin reviews for risky actions, and an audit log of everything.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SignInButton disabled={blocked} large />
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-xl border border-rose-400/50 bg-accent-soft px-5 py-3 font-semibold text-rose-100 hover:bg-rose-500/20"
            >
              <PlayIcon className="size-4" /> Try the live demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            The demo needs no sign-in: it runs on a pretend GitHub account. For your real one it&apos;s one approval, and
            your GitHub access stays in your own browser, never in our database.
          </p>

          {signInError && !blocked && (
            <div role="alert" className="mt-6 max-w-lg rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-semibold">Sign-in didn&apos;t complete</p>
              <p className="mt-1 text-amber-100/80">{SIGN_IN_ERRORS[signInError] ?? DEFAULT_SIGN_IN_ERROR}</p>
              <ClearUrlError />
            </div>
          )}

          {databaseDown && missing.length === 0 && (
            <div className="mt-6 max-w-lg rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
              <p className="font-semibold">Can&apos;t reach the database</p>
              <p className="mt-1 text-red-100/80">
                Check <code>DATABASE_URL</code>, then open <code>/api/health</code> to confirm the connection.
              </p>
            </div>
          )}

          {missing.length > 0 && (
            <div className="mt-6 max-w-lg rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-semibold">Deployment setup required</p>
              <p className="mt-1 text-amber-100/80">
                Run <code>npm run setup</code> or set these variables, then reload:
              </p>
              <p className="mt-2 font-mono text-xs">{missing.join(" · ")}</p>
            </div>
          )}
        </div>
        <ProductPreview />
      </section>

      <section className="relative border-y border-line bg-ink-950/50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-6 text-sm text-zinc-500">
          {["Next.js 16", "LangGraph.js", "Auth.js", "Postgres · Supabase · Neon", "Octokit", "Vercel"].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section id="features" className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white">Everything a team needs to let an AI touch GitHub</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-400">Powerful enough to do real work, controlled enough to trust.</p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="group rounded-2xl border border-line bg-ink-850/50 p-6 transition hover:border-rose-400/40 hover:bg-ink-850">
              <div className="mb-4 inline-flex rounded-xl bg-accent-soft p-2.5 text-rose-300">
                <Icon />
              </div>
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="security" className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="grid gap-10 rounded-3xl border border-line bg-gradient-to-br from-ink-850 to-ink-950 p-8 sm:p-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="mb-4 inline-flex rounded-xl bg-accent-soft p-2.5 text-rose-300">
              <ShieldIcon />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Secure by default</h2>
            <p className="mt-3 text-zinc-400">
              The assistant acts as you, with access that stays in your own browser, and nothing changes without your
              click. Every guarantee below is enforced in code and covered by tests.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SAFETY.map((item) => (
              <li key={item} className="flex gap-3 rounded-xl border border-line bg-black/20 p-4 text-sm text-zinc-300">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <h2 className="mb-8 text-center text-sm font-semibold tracking-widest text-zinc-400 uppercase">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], index) => (
            <li key={title} className="rounded-2xl border border-line p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{index + 1}</span>
              <p className="mt-4 font-semibold text-white">{title}</p>
              <p className="mt-1 text-sm text-zinc-400">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="flex flex-col items-center gap-6 rounded-3xl border border-rose-500/30 bg-[radial-gradient(ellipse_at_center,rgba(225,29,72,0.18),transparent_70%)] px-6 py-14 text-center">
          <BoltIcon className="size-8 text-rose-300" />
          <h2 className="text-3xl font-bold tracking-tight text-white">Try it now</h2>
          <p className="max-w-lg text-zinc-400">
            Play with the demo account in seconds, no sign-in needed. Or sign in and approve your first real change in
            under a minute.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg shadow-rose-950/40 hover:bg-rose-500"
            >
              <PlayIcon className="size-4" /> Try the live demo
            </Link>
            <SignInButton disabled={blocked} large />
          </div>
        </div>
      </section>

      <footer className="relative border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-zinc-500 sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark className="size-5" /> GitHubOps AI
          </span>
          <span>Built with Next.js, LangGraph.js, Auth.js and Postgres.</span>
          <a href={REPO_URL} className="hover:text-zinc-300">GitHub</a>
        </div>
      </footer>
    </main>
  );
}
