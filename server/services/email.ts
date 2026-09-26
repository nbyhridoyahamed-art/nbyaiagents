import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export type EmailTemplate =
  | "verification"
  | "password_reset"
  | "invitation"
  | "approval_request"
  | "agent_escalation"
  | "workflow_notification"
  | "system_alert";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  template: EmailTemplate;
  orgId?: string;
}

interface EmailTransport {
  name: string;
  send(email: OutgoingEmail): Promise<"SENT" | "LOGGED">;
}

/** Development transport: prints the message to the server console. Nothing is delivered. */
const consoleTransport: EmailTransport = {
  name: "console",
  async send(email) {
    // Bodies can contain one-time links (password reset, invites): only print them in development.
    const body = process.env.NODE_ENV === "production" ? "(body hidden in production — configure EMAIL_PROVIDER to deliver email)" : email.text;
    console.log(
      `\n──── [email:${email.template}] (not delivered — EMAIL_PROVIDER=console) ────\nTo: ${email.to}\nSubject: ${email.subject}\n\n${body}\n────────────────────────────────────────\n`,
    );
    return "LOGGED";
  },
};

const resendTransport: EmailTransport = {
  name: "resend",
  async send(email) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env().EMAIL_FROM, to: email.to, subject: email.subject, text: email.text }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    return "SENT";
  },
};

/** Local mailbox for development and end-to-end tests: one JSON file per message. Refused on non-local URLs. */
const fileTransport: EmailTransport = {
  name: "file",
  async send(email) {
    const host = new URL(env().APP_URL).hostname;
    if (!["localhost", "127.0.0.1"].includes(host)) throw new Error("EMAIL_PROVIDER=file is only allowed when APP_URL is localhost.");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.resolve(env().EMAIL_FILE_DIR);
    await fs.mkdir(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await fs.writeFile(path.join(dir, name), JSON.stringify({ to: email.to, subject: email.subject, template: email.template, text: email.text, at: new Date().toISOString() }, null, 2));
    return "LOGGED";
  },
};

function transport(): EmailTransport {
  const e = env();
  if (e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY) return resendTransport;
  if (e.EMAIL_PROVIDER === "file") return fileTransport;
  return consoleTransport;
}

/** Sends a transactional email and records it in the outbox. Never throws to callers. */
export async function sendEmail(email: OutgoingEmail) {
  const t = transport();
  try {
    const status = await t.send(email);
    await prisma.emailMessage.create({
      data: { orgId: email.orgId, to: email.to, subject: email.subject, template: email.template, status, provider: t.name },
    });
  } catch (err) {
    console.error("[email] send failed", { template: email.template, err: String(err) });
    await prisma.emailMessage
      .create({
        data: {
          orgId: email.orgId,
          to: email.to,
          subject: email.subject,
          template: email.template,
          status: "FAILED",
          provider: t.name,
          error: String(err).slice(0, 500),
        },
      })
      .catch(() => {});
  }
}
