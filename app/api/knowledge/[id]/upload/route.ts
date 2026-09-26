import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/context";
import { userActor } from "@/lib/auth/actor";
import { isAppError } from "@/lib/errors";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/security/uploads";
import { isSameOrigin } from "@/lib/security/same-origin";
import { uploadDocument } from "@/server/services/knowledge";

/** Multipart upload of one or more knowledge files into a collection. */
export async function POST(request: Request, ctx: RouteContext<"/api/knowledge/[id]/upload">) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  const org = await getOrgContext();
  if (!org) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!org.can("knowledge:write")) return NextResponse.json({ error: "Your role can't add knowledge." }, { status: 403 });
  const limit = await hitRateLimit("upload", `${org.org.id}:${org.user.id}`);
  if (!limit.allowed) return NextResponse.json({ error: "Too many uploads. Try again in a minute." }, { status: 429 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES * 5 + 1024 * 1024) return NextResponse.json({ error: "Upload too large (max 20 MB per file, 5 files at a time)." }, { status: 413 });

  const { id } = await ctx.params;
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 5);
  if (!files.length) return NextResponse.json({ error: "Choose at least one file." }, { status: 400 });

  const results: { name: string; ok: boolean; error?: string; id?: string }[] = [];
  for (const file of files) {
    try {
      const doc = await uploadDocument(userActor(org.org.id, org.user.id), id, file);
      results.push({ name: file.name, ok: true, id: doc.id });
    } catch (err) {
      results.push({ name: file.name, ok: false, error: isAppError(err) ? err.message : "Upload failed." });
      if (!isAppError(err)) console.error("[upload] failed", err);
    }
  }
  return NextResponse.json({ results });
}
