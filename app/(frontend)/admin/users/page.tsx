// /admin/users: manage people: roles, per-user permission exceptions, disabling accounts, revoking GitHub tokens.
import { AdminNav } from "@/frontend/components/AdminNav";
import { Shell } from "@/frontend/components/Shell";
import { Card, Page, PageHeader, timeAgo } from "@/frontend/components/ui";
import { UsersTable } from "@/frontend/components/UsersTable";
import { query } from "@/backend/db";
import { loadWorkspace } from "@/backend/pages";
import { ROLES } from "@/backend/rbac";
import { listUsers } from "@/backend/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

export default async function AdminUsersPage() {
  const { user, shell } = await loadWorkspace("admin.users");
  const [users, permissions, grants, roles] = await Promise.all([
    listUsers(),
    query<{ name: string; description: string }>("SELECT name, description FROM permissions ORDER BY name"),
    query<{ role: string; permission: string }>("SELECT role, permission FROM role_permissions"),
    query<{ name: string; description: string }>("SELECT name, description FROM roles ORDER BY rank"),
  ]);
  const rolePermissions: Record<string, string[]> = {};
  for (const { role, permission } of grants) (rolePermissions[role] ??= []).push(permission);

  return (
    <Shell shell={shell}>
      <Page wide>
        <PageHeader
          eyebrow="Admin"
          title="Users & access"
          description="Assign roles, add per-user permission exceptions, disable accounts and revoke GitHub tokens. Every change is audited."
          actions={<AdminNav active="users" canManageUsers />}
        />
        <UsersTable
          users={users.map((item) => ({ ...item, seen: timeAgo(item.lastSeenAt) }))}
          roles={[...ROLES]}
          permissions={permissions}
          rolePermissions={rolePermissions}
          selfId={user.id}
        />
        <Card title="Roles" className="mt-6">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((role) => (
              <div key={role.name}>
                <dt className="font-semibold text-white capitalize">{role.name}</dt>
                <dd className="mt-1 text-sm text-zinc-400">{role.description}</dd>
                <dd className="mt-1 text-xs text-zinc-500">{rolePermissions[role.name]?.length ?? 0} permissions</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Page>
    </Shell>
  );
}
