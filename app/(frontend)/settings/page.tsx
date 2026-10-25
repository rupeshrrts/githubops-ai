// /settings: the user's GitHub connection (one-click connect, reconnect, disconnect, or their own key),
// role, permissions and today's usage.
import { DisconnectButton, GithubKeyForm } from "@/frontend/components/AccountActions";
import { CheckIcon, GitHubIcon, LockIcon } from "@/frontend/components/icons";
import { Shell } from "@/frontend/components/Shell";
import { Badge, buttonStyles, Card, Page, PageHeader, timeAgo } from "@/frontend/components/ui";
import { signInWithGitHub } from "@/backend/actions";
import { query } from "@/backend/db";
import { readGithubKey } from "@/backend/github/key";
import { FINE_GRAINED_KEY_URL, missingScopes, newKeyUrl, requestedScopes } from "@/backend/github/scopes";
import { loadWorkspace } from "@/backend/pages";
import { PERMISSIONS } from "@/backend/rbac";
import { usageToday } from "@/backend/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

function ConnectButton({ label }: { label: string }) {
  return (
    <form action={signInWithGitHub}>
      <button type="submit" className={buttonStyles.primary}>
        <GitHubIcon className="size-4" /> {label}
      </button>
    </form>
  );
}

/** For people who'd rather pick exact repositories than approve the app's one-click access. */
function OwnKeyOption() {
  return (
    <details className="mt-5 rounded-xl border border-line bg-black/20 p-4">
      <summary className="cursor-pointer text-sm font-medium text-zinc-300">
        Advanced: use a key you create yourself instead
      </summary>
      <div className="mt-3 space-y-3 text-sm text-zinc-400">
        <p>
          Create a key on GitHub (
          <a href={newKeyUrl()} target="_blank" rel="noreferrer" className="text-rose-300 underline">
            classic
          </a>
          , or{" "}
          <a href={FINE_GRAINED_KEY_URL} target="_blank" rel="noreferrer" className="text-rose-300 underline">
            fine-grained
          </a>{" "}
          to pick exact repositories), copy it, and paste it here. It is kept the same way: only in this browser.
        </p>
        <GithubKeyForm />
      </div>
    </details>
  );
}

export default async function SettingsPage() {
  const { user, shell } = await loadWorkspace();
  const [key, usage, permissionRows] = await Promise.all([
    readGithubKey(user.id),
    usageToday(user.id),
    query<{ name: string; description: string }>("SELECT name, description FROM permissions ORDER BY name"),
  ]);
  const missing = new Set(key?.scopes != null ? missingScopes(key.scopes) : []);
  const limit = Number(process.env.DAILY_MESSAGE_LIMIT || 50);

  return (
    <Shell shell={shell}>
      <Page>
        <PageHeader title="Settings" description="Your GitHub connection, access and usage." />

        <div className="space-y-6">
          <section id="github-key" className="scroll-mt-6">
            <Card
              title="GitHub connection"
              actions={
                key && (
                  <div className="flex flex-wrap gap-2">
                    {key.source === "sign-in" && <ConnectButton label="Reconnect" />}
                    <DisconnectButton />
                  </div>
                )
              }
            >
              {!key ? (
                <>
                  <p className="text-sm text-zinc-300">
                    Connect GitHub with one approval. GitHub asks you once to allow access; that access is then kept
                    only in this browser, encrypted, and is never saved in the portal&apos;s database.
                  </p>
                  <div className="mt-4">
                    <ConnectButton label="Connect GitHub" />
                  </div>
                  <OwnKeyOption />
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-4">
                    {user.image && <img src={user.image} alt="" className="size-12 rounded-full" />}
                    <div className="flex-1">
                      <p className="font-medium text-white">@{key.login || user.login}</p>
                      <p className="text-sm text-zinc-400">
                        Connected {timeAgo(key.savedAt)} · {key.source === "sign-in" ? "with GitHub sign-in" : "with your own key"}
                      </p>
                    </div>
                    <Badge tone="green">
                      <LockIcon className="size-3.5" /> Only in this browser, encrypted
                    </Badge>
                  </div>

                  <p className="mt-5 mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">GitHub access</p>
                  {key.scopes != null ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {requestedScopes().map((scope) => (
                          <Badge key={scope} tone={missing.has(scope) ? "red" : "neutral"}>
                            {!missing.has(scope) && <CheckIcon className="size-3" />}
                            <span className="font-mono">{scope}</span>
                          </Badge>
                        ))}
                      </div>
                      {missing.size > 0 && (
                        <p className="mt-2 text-sm text-amber-200">
                          Red ones are missing, so those actions will fail.{" "}
                          {key.source === "sign-in" ? "Click Reconnect to grant them." : "Add them to your key on GitHub."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-zinc-300">Exactly the repositories and permissions you chose on GitHub.</p>
                  )}
                  {key.source === "own-key" && (
                    <p className="mt-3 text-xs text-zinc-500">
                      To switch your key off everywhere, delete it on GitHub:{" "}
                      <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="underline">
                        classic keys
                      </a>{" "}
                      or{" "}
                      <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer" className="underline">
                        fine-grained keys
                      </a>
                      .
                    </p>
                  )}
                </>
              )}
            </Card>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Your role">
              <p className="text-2xl font-semibold text-white capitalize">{user.access.role}</p>
              <p className="mt-1 text-sm text-zinc-400">Roles and exceptions are managed by admins.</p>
            </Card>
            <Card title="Usage today">
              <p className="text-2xl font-semibold text-white">
                {usage} <span className="text-base font-normal text-zinc-500">/ {limit}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (usage / limit) * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-zinc-400">AI requests reset at midnight UTC.</p>
            </Card>
          </div>

          <Card title="What you can do">
            <ul className="grid gap-2 sm:grid-cols-2">
              {permissionRows
                .filter((row) => (PERMISSIONS as readonly string[]).includes(row.name))
                .map((row) => {
                  const allowed = user.access.permissions.has(row.name as (typeof PERMISSIONS)[number]);
                  return (
                    <li key={row.name} className={`flex gap-2 text-sm ${allowed ? "text-zinc-200" : "text-zinc-500"}`}>
                      <span className={allowed ? "text-emerald-400" : "text-zinc-600"}>{allowed ? "✓" : "–"}</span>
                      <span>
                        {row.description} <code className="text-xs text-zinc-500">{row.name}</code>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </Card>
        </div>
      </Page>
    </Shell>
  );
}
