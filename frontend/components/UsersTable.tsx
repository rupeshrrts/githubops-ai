// Admin user management: role, status, GitHub token, usage, and per-user permission exceptions.
"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { Badge, buttonStyles } from "@/frontend/components/ui";
import type { ManagedUser } from "@/backend/types";

type Permission = { name: string; description: string };

const select =
  "rounded-lg border border-line bg-ink-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-rose-400 disabled:opacity-50";

export function UsersTable({
  users,
  roles,
  permissions,
  rolePermissions,
  selfId,
}: {
  users: (ManagedUser & { seen: string })[];
  roles: string[];
  permissions: Permission[];
  rolePermissions: Record<string, string[]>;
  selfId: string;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(user: ManagedUser, body: Record<string, unknown>, question?: string) {
    if (question && !confirm(question)) return;
    setBusy(user.id);
    setError(null);
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) setError((await response.json().catch(() => ({}))).error ?? "Change failed.");
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      {error && <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-850 text-xs tracking-wide text-zinc-400 uppercase">
            <tr>
              {["User", "Role", "Status", "GitHub", "Today", "Last seen", ""].map((heading) => (
                <th key={heading} className="px-4 py-3 font-medium whitespace-nowrap">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => {
              const self = user.id === selfId;
              const locked = busy === user.id;
              const defaults = new Set(rolePermissions[user.role] ?? []);
              const overrideCount = Object.keys(user.overrides).length;
              return (
                <Fragment key={user.id}>
                  <tr className={user.disabled ? "opacity-60" : ""}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.image ? <img src={user.image} alt="" className="size-8 rounded-full" /> : <div className="size-8 rounded-full bg-ink-700" />}
                        <div>
                          <p className="font-medium text-white">
                            @{user.login ?? "unknown"} {self && <span className="text-xs text-zinc-500">(you)</span>}
                          </p>
                          {user.name && <p className="text-xs text-zinc-500">{user.name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className={select}
                        value={user.role}
                        disabled={locked}
                        onChange={(event) =>
                          change(user, { role: event.target.value }, `Change @${user.login}'s role to ${event.target.value}?`)
                        }
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {user.disabled ? <Badge tone="red">Disabled</Badge> : <Badge tone="green">Active</Badge>}
                    </td>
                    <td className="px-4 py-3">{user.hasToken ? <Badge>Connected</Badge> : <Badge tone="amber">No token</Badge>}</td>
                    <td className="px-4 py-3 text-zinc-300">{user.usageToday}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-400">{user.seen}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" className={buttonStyles.ghost} onClick={() => setExpanded(expanded === user.id ? null : user.id)}>
                          Permissions{overrideCount > 0 && ` (${overrideCount})`}
                        </button>
                        {!self && (
                          <button
                            type="button"
                            disabled={locked}
                            className={buttonStyles.ghost}
                            onClick={() =>
                              change(
                                user,
                                { disabled: !user.disabled },
                                user.disabled ? `Re-enable @${user.login}?` : `Disable @${user.login}? They are signed out immediately.`,
                              )
                            }
                          >
                            {user.disabled ? "Enable" : "Disable"}
                          </button>
                        )}
                        {!self && user.hasToken && (
                          <button
                            type="button"
                            disabled={locked}
                            className={`${buttonStyles.ghost} text-red-300`}
                            onClick={() =>
                              change(user, { revokeToken: true }, `Delete @${user.login}'s stored GitHub token? They must sign in again.`)
                            }
                          >
                            Revoke token
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === user.id && (
                    <tr className="bg-black/20">
                      <td colSpan={7} className="px-4 py-4">
                        <p className="mb-3 text-xs text-zinc-400">
                          Exceptions on top of the <span className="text-zinc-200">{user.role}</span> role. &quot;Role default&quot; follows the role.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {permissions.map((permission) => {
                            const override = user.overrides[permission.name];
                            const value = override === undefined ? "default" : override ? "allow" : "deny";
                            const effective = override ?? defaults.has(permission.name);
                            return (
                              <label key={permission.name} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                                <span className={`size-2 shrink-0 rounded-full ${effective ? "bg-emerald-400" : "bg-zinc-600"}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="block font-mono text-xs text-zinc-200">{permission.name}</span>
                                  <span className="block truncate text-xs text-zinc-500" title={permission.description}>
                                    {permission.description}
                                  </span>
                                </span>
                                <select
                                  className={select}
                                  value={value}
                                  disabled={locked}
                                  onChange={(event) =>
                                    change(user, {
                                      override: {
                                        permission: permission.name,
                                        allowed: event.target.value === "default" ? null : event.target.value === "allow",
                                      },
                                    })
                                  }
                                >
                                  <option value="default">Role default ({defaults.has(permission.name) ? "on" : "off"})</option>
                                  <option value="allow">Allow</option>
                                  <option value="deny">Deny</option>
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
