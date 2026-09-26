import type { KnowledgeFileKind } from "@/lib/security/uploads";

/** Extracted text, optionally split into pages (PDF) so citations can point to a page. */
export interface Extracted {
  pages: { page: number | null; text: string }[];
  pageCount: number | null;
}

export async function extractFile(kind: KnowledgeFileKind, bytes: Buffer): Promise<Extracted> {
  switch (kind) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text, totalPages } = await extractText(pdf, { mergePages: false });
      const pages = (Array.isArray(text) ? text : [text]).map((t, i) => ({ page: i + 1, text: t }));
      return { pages, pageCount: totalPages };
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      return { pages: [{ page: null, text: value }], pageCount: null };
    }
    case "xlsx": {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((sheet) => {
        const rows: string[] = [];
        let header: string[] = [];
        sheet.eachRow((row, idx) => {
          const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
          if (idx === 1) header = values;
          else if (idx <= 5001) rows.push(values.map((v, i) => `${header[i] || `Column ${i + 1}`}: ${v}`).join("; "));
        });
        parts.push(`# Sheet: ${sheet.name}\n${rows.join("\n")}`);
      });
      return { pages: [{ page: null, text: parts.join("\n\n") }], pageCount: null };
    }
    case "csv": {
      const Papa = (await import("papaparse")).default;
      const parsed = Papa.parse<Record<string, string>>(bytes.toString("utf8"), { header: true, skipEmptyLines: true });
      const lines = parsed.data.slice(0, 5000).map((row) =>
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join("; "),
      );
      return { pages: [{ page: null, text: lines.join("\n") }], pageCount: null };
    }
    case "md":
    case "txt":
      return { pages: [{ page: null, text: bytes.toString("utf8") }], pageCount: null };
  }
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text) return o.text;
    if (o.result !== undefined) return String(o.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

/** Converts HTML to readable text (scripts/styles/nav removed). */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, "\n## ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return { title: title ? htmlToText(title).text : null, text };
}

export function sitemapUrls(xml: string, limit = 25): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, limit);
}

/** Normalises whitespace and strips control characters. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
