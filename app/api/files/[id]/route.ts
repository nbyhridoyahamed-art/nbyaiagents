import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";
import { verifySignedValue } from "@/lib/security/crypto";

export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifySignedValue(id, exp, sig)) return NextResponse.json({ error: "Link expired" }, { status: 403 });

  const org = await getOrgContext();
  if (!org) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const file = await prisma.storedFile.findFirst({ where: { id, orgId: org.org.id } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await storage().get(file.storageKey);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      // Always download (never render inline) to avoid content-type confusion attacks.
      // ASCII fallback + RFC 5987 UTF-8 name (header values must be Latin-1, so "résumé.pdf" would otherwise throw).
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
