// /settings: the user's GitHub connection (granted scopes, encrypted token, reconnect/disconnect), role,
// permissions and today's usage.
import { AccountActions } from "@/frontend/components/AccountActions";
import { CheckIcon, KeyIcon } from "@/frontend/components/icons";
import { Shell } from "@/frontend/components/Shell";
import { Badge, Card, Page, PageHeader, timeAgo } from "@/frontend/components/ui";
import { query } from "@/backend/db";
import { missingScopes, requestedScopes } from "@/backend/github/scopes";
import { loadWorkspace } from "@/backend/pages";
import { PERMISSIONS } from "@/backend/rbac";
import { getAccountSummary } from "@/backend/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, shell } = await loadWorkspace();
  const account = await getAccountSummary(user.id);
  const missing = new Set(missingScopes(account?.scope ?? null));
  const permissionRows = await query<{ name: string; description: string }>(
    "SELECT name, description FROM permissions ORDER BY name",
  );
  const limit = Number(process.env.DAILY_MESSAGE_LIMIT || 50);

  return (
    <Shell shell={shell}>
      <Page>
        <PageHeader title="Settings" description="Your GitHub connection, access and usage." />

        <div className="space-y-6">
          <Card title="GitHub connection" actions={<AccountActions />}>
            <div className="flex flex-wrap items-center gap-4">
              {user.image && <img src={user.image} alt="" className="size-12 rounded-full" />}
              <div className="flex-1">
                <p className="font-medium text-white">@{user.login ?? "unknown"}</p>
                <p className="text-sm text-zinc-400">
                  {account?.connected ? (
                    <>Connected · token refreshed {timeAgo(account.tokenUpdatedAt)}</>
                  ) : (
                    "Not connected. Use Reconnect to sign in with GitHub again."
                  )}
                </p>
              </div>
              <Badge tone="green">
                <KeyIcon className="size-3.5" /> Encrypted at rest (AES-256-GCM)
              </Badge>
            </div>

            <p className="mt-5 mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">GitHub access granted</p>
            <div className="flex flex-wrap gap-1.5">
              {requestedScopes().map((scope) => (
                <Badge key={scope} tone={missing.has(scope) ? "red" : "neutral"}>
                  {!missing.has(scope) && <CheckIcon className="size-3" />}
                  <span className="font-mono">{scope}</span>
                </Badge>
              ))}
            </div>
            {missing.size > 0 && (
              <p className="mt-2 text-sm text-amber-200">Red scopes are missing. Click Reconnect to grant them.</p>
            )}
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Your role">
              <p className="text-2xl font-semibold text-white capitalize">{user.access.role}</p>
              <p className="mt-1 text-sm text-zinc-400">Roles and exceptions are managed by admins.</p>
            </Card>
            <Card title="Usage today">
              <p className="text-2xl font-semibold text-white">
                {account?.usage ?? 0} <span className="text-base font-normal text-zinc-500">/ {limit}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ((account?.usage ?? 0) / limit) * 100)}%` }} />
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
