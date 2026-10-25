// Tabs at the top of the admin pages.
import Link from "next/link";

export function AdminNav({ active, canManageUsers }: { active: "overview" | "users"; canManageUsers: boolean }) {
  const tab = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${on ? "bg-accent-soft text-white" : "text-zinc-400 hover:text-white"}`;
  return (
    <div className="flex rounded-xl border border-line p-1">
      <Link href="/admin" className={tab(active === "overview")}>
        Overview
      </Link>
      {canManageUsers && (
        <Link href="/admin/users" className={tab(active === "users")}>
          Users
        </Link>
      )}
      <Link href="/audit?scope=all" className={tab(false)}>
        Audit
      </Link>
    </div>
  );
}
