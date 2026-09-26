import type { Metadata } from "next";
import { format, formatDistanceToNow } from "date-fns";
import { requirePlatformAdminPage } from "@/lib/auth/admin";
import { listUsersForAdmin } from "@/server/services/admin";
import { UserActions } from "./user-actions";

export const metadata: Metadata = { title: "Users" };

export default async function AdminUsersPage(props: PageProps<"/admin/users">) {
  const admin = await requirePlatformAdminPage();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : undefined;
  const users = await listUsersForAdmin(q);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-page-title">Users</h1>
        <form role="search">
          <input name="q" defaultValue={q} placeholder="Search email or name" aria-label="Search users" className="h-9 w-64 rounded-lg border bg-surface px-3 text-[13px]" />
        </form>
      </div>
      <div className="overflow-x-auto rounded-[14px] border bg-surface shadow-card">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b text-left text-xs text-text-muted">
              {["User", "Companies", "Verified", "Last sign-in", "Joined", "Status", ""].map((h, i) => (
                <th key={i} scope="col" className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  {u.name}
                  {u.platformRole === "SUPER_ADMIN" && <span className="ml-2 rounded bg-foreground px-1.5 py-0.5 text-[10.5px] font-semibold text-background">Platform admin</span>}
                  <span className="block text-[12px] font-normal text-text-muted">{u.email}</span>
                </th>
                <td className="px-4 py-3 text-text-secondary">{u.orgs.map((o) => `${o.name} (${o.role.toLowerCase()})`).join(", ") || "—"}</td>
                <td className="px-4 py-3">{u.verified ? "Yes" : "No"}</td>
                <td className="px-4 py-3 text-text-secondary">{u.lastLoginAt ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true }) : "never"}</td>
                <td className="px-4 py-3 text-text-secondary">{format(new Date(u.createdAt), "PP")}</td>
                <td className="px-4 py-3">
                  {u.disabledAt ? (
                    <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-danger-text">Disabled</span>
                  ) : (
                    <span className="rounded bg-success-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-success-text">Active</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{u.id !== admin.userId && <UserActions user={{ id: u.id, email: u.email, disabled: !!u.disabledAt, admin: u.platformRole === "SUPER_ADMIN" }} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
