import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/knowledge/chunk";
import { cleanText, htmlToText, sitemapUrls } from "@/lib/knowledge/extract";
import { cosineSimilarity, localEmbed } from "@/lib/knowledge/embeddings";
import { validateKnowledgeUpload } from "@/lib/security/uploads";
import { assertSafeUrl, isPrivateAddress } from "@/lib/security/ssrf";
import { buildHttpRequest, httpConfigSchema, httpInputJsonSchema, httpInputZod } from "@/lib/tools/http-config";
import { validateOutput } from "@/lib/ai/output-spec";
import { isAppError } from "@/lib/errors";

describe("chunking", () => {
  it("keeps page numbers and headings, and splits long text", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about refunds and shipping policy details.`).join(" ");
    const chunks = chunkPages(
      [
        { page: 1, text: "## Refunds\n\nCustomers may request a refund within 30 days.\n\n" + long },
        { page: 2, text: "## Shipping\n\nWe ship worldwide within 5 business days." },
      ],
      { targetChars: 800, overlapChars: 100 },
    );
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].heading).toBe("Refunds");
    expect(chunks[0].pageNumber).toBe(1);
    const last = chunks[chunks.length - 1];
    expect(last.pageNumber).toBe(2);
    expect(last.heading).toBe("Shipping");
    expect(chunks.every((c) => c.content.length <= 1200)).toBe(true);
  });
});

describe("extraction helpers", () => {
  it("strips scripts and tags from HTML", () => {
    const { title, text } = htmlToText("<html><head><title>FAQ</title><script>alert(1)</script></head><body><h1>Returns</h1><p>Within 30 days.</p></body></html>");
    expect(title).toBe("FAQ");
    expect(text).not.toContain("alert");
    expect(cleanText(text)).toContain("Within 30 days.");
  });
  it("reads sitemap locations", () => {
    expect(sitemapUrls("<urlset><url><loc>https://a.com/x</loc></url><url><loc> https://a.com/y </loc></url></urlset>")).toEqual(["https://a.com/x", "https://a.com/y"]);
  });
});

describe("local embeddings", () => {
  it("scores related text higher than unrelated text", () => {
    const q = localEmbed("How do refunds work?");
    const related = localEmbed("Refund policy: customers can get a refund within 30 days.");
    const unrelated = localEmbed("Our office is closed on public holidays.");
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });
});

describe("upload validation", () => {
  const pdf = Buffer.from("%PDF-1.7\n...binary...");
  it("accepts a real PDF", () => {
    expect(validateKnowledgeUpload({ name: "a.pdf", type: "application/pdf", size: pdf.length }, pdf)).toBe("pdf");
  });
  it("rejects a disguised executable", () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    expect(() => validateKnowledgeUpload({ name: "invoice.pdf", type: "application/pdf", size: exe.length }, exe)).toThrow();
  });
  it("rejects content that doesn't match the extension", () => {
    const txt = Buffer.from("hello");
    expect(() => validateKnowledgeUpload({ name: "a.pdf", type: "application/pdf", size: txt.length }, txt)).toThrow(/valid PDF/);
  });
  it("rejects unsupported extensions and binary text", () => {
    expect(() => validateKnowledgeUpload({ name: "a.exe", type: "application/octet-stream", size: 3 }, Buffer.from("abc"))).toThrow(/Unsupported/);
    expect(() => validateKnowledgeUpload({ name: "a.txt", type: "text/plain", size: 3 }, Buffer.from([0x61, 0x00, 0x62]))).toThrow();
  });
});

describe("SSRF protection", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("rejects unsafe URLs", () => {
    for (const url of ["file:///etc/passwd", "http://localhost/x", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "https://user:pass@example.com", "http://printer.local/"]) {
      expect(() => assertSafeUrl(url), url).toThrow();
    }
    expect(assertSafeUrl("https://api.example.com/v1").hostname).toBe("api.example.com");
  });
});

describe("custom REST tool builder", () => {
  const cfg = httpConfigSchema.parse({
    method: "POST",
    url: "https://api.example.com/orders/{order_id}/notes",
    parameters: [
      { name: "order_id", in: "path", type: "string", required: true, description: "Order" },
      { name: "verbose", in: "query", type: "boolean", required: false },
      { name: "note", in: "body", type: "string", required: true },
    ],
    auth: { type: "api_key", credentialId: "cred_1", location: "header", keyName: "X-Api-Key" },
  });

  it("generates a machine-readable input schema", () => {
    const schema = httpInputJsonSchema(cfg.parameters);
    expect(schema.required).toEqual(["order_id", "note"]);
    expect(httpInputZod(cfg.parameters).safeParse({ order_id: "7", note: "hi" }).success).toBe(true);
    expect(httpInputZod(cfg.parameters).safeParse({ note: "hi" }).success).toBe(false);
    expect(httpInputZod(cfg.parameters).safeParse({ order_id: "7", note: "x", extra: 1 }).success).toBe(false);
  });

  it("builds the request with encoded path params and injected secret", () => {
    const req = buildHttpRequest(cfg, { order_id: "a/b", verbose: true, note: "hello" }, "SECRET");
    expect(req.url).toBe("https://api.example.com/orders/a%2Fb/notes?verbose=true");
    expect(req.headers["X-Api-Key"]).toBe("SECRET");
    expect(JSON.parse(req.body!)).toEqual({ note: "hello" });
  });

  it("rejects plain-text secrets in static headers and missing path params", () => {
    expect(httpConfigSchema.safeParse({ method: "GET", url: "https://x.com/a", headers: [{ name: "Authorization", value: "Bearer abc" }] }).success).toBe(false);
    expect(httpConfigSchema.safeParse({ method: "GET", url: "https://x.com/{id}" }).success).toBe(false);
  });

  it("strips header injection", () => {
    const c = httpConfigSchema.parse({ method: "GET", url: "https://x.com/a", parameters: [{ name: "trace", in: "header", type: "string" }] });
    expect(buildHttpRequest(c, { trace: "a\r\nX-Evil: 1" }).headers.trace).not.toMatch(/[\r\n]/);
  });
});

describe("structured output validation", () => {
  const spec = { name: "s", fields: [{ name: "score", type: "integer" as const, description: "", required: true, min: 0, max: 100 }] };
  it("accepts JSON inside code fences", () => {
    expect(validateOutput(spec, "```json\n{\"score\": 80}\n```")).toEqual({ ok: true, value: { score: 80 } });
  });
  it("reports schema errors", () => {
    const r = validateOutput(spec, '{"score": 180}');
    expect(r.ok).toBe(false);
  });
});

void isAppError;
