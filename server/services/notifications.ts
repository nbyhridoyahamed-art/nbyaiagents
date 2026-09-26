import { prisma } from "@/lib/db";
import type { OrgRole } from "@/lib/generated/prisma/enums";
import { roleHas, type Permission } from "@/lib/permissions/rbac";
import { sendEmail, type EmailTemplate } from "@/server/services/email";
import { env } from "@/lib/env";

/** Creates an in-app notification for every member holding `permission`. */
export async function notifyMembers(
  orgId: string,
  permission: Permission,
  n: { type: string; title: string; body?: string; link?: string; email?: EmailTemplate },
) {
  const members = await prisma.organizationMember.findMany({ where: { orgId }, include: { user: { select: { id: true, email: true } } } });
  const recipients = members.filter((m) => roleHas(m.role as OrgRole, permission));
  if (recipients.length === 0) return;
  await prisma.notification.createMany({
    data: recipients.map((m) => ({ orgId, userId: m.user.id, type: n.type, title: n.title, body: n.body, link: n.link })),
  });
  if (n.email) {
    for (const m of recipients) {
      await sendEmail({
        to: m.user.email,
        orgId,
        template: n.email,
        subject: n.title,
        text: `${n.title}\n\n${n.body ?? ""}\n\n${n.link ? `${env().APP_URL}${n.link}` : ""}`,
      });
    }
  }
}

export async function notifyUser(orgId: string, userId: string, n: { type: string; title: string; body?: string; link?: string }) {
  await prisma.notification.create({ data: { orgId, userId, ...n } });
}
