import "server-only";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/auth/context";

/**
 * Platform administration is separate from organization roles (spec §122): only
 * users with the SUPER_ADMIN platform role get in, regardless of company role.
 * Everyone else gets a 404 so the area's existence isn't revealed.
 */
export async function requirePlatformAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (session.user.platformRole !== "SUPER_ADMIN") notFound();
  return { userId: session.user.id, name: session.user.name, email: session.user.email };
}

export async function requirePlatformAdmin() {
  const session = await getSession();
  if (!session || session.user.platformRole !== "SUPER_ADMIN") throw new AppError("NOT_FOUND", "Not found.");
  return { userId: session.user.id };
}
