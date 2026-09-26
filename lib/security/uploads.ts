import { AppError } from "@/lib/errors";

/**
 * Upload validation (spec §116): extension allow-list, declared MIME, size, and
 * *content sniffing* — the bytes must match the claimed type. Executables are
 * always rejected. Extracted text is treated as untrusted content downstream.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type KnowledgeFileKind = "pdf" | "docx" | "xlsx" | "csv" | "md" | "txt";

const EXT: Record<string, KnowledgeFileKind> = { pdf: "pdf", docx: "docx", xlsx: "xlsx", csv: "csv", md: "md", markdown: "md", txt: "txt" };

const MIME: Record<KnowledgeFileKind, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"],
  md: ["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream", ""],
  txt: ["text/plain", "application/octet-stream", ""],
};

export const CANONICAL_MIME: Record<KnowledgeFileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
};

function startsWith(buf: Buffer, sig: number[]) {
  return sig.every((b, i) => buf[i] === b);
}

function looksExecutable(buf: Buffer) {
  return (
    startsWith(buf, [0x4d, 0x5a]) || // MZ (Windows PE)
    startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O
    startsWith(buf, [0x23, 0x21]) // #! script
  );
}

function isUtf8Text(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

export function validateKnowledgeUpload(file: { name: string; type: string; size: number }, bytes: Buffer): KnowledgeFileKind {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = EXT[ext];
  if (!kind) throw new AppError("VALIDATION", `Unsupported file type ".${ext}". Upload PDF, DOCX, XLSX, CSV, Markdown or TXT.`);
  if (file.size === 0 || bytes.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES || bytes.length > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be at most 20 MB.");
  if (!MIME[kind].includes(file.type)) throw new AppError("VALIDATION", `The file's type (${file.type || "unknown"}) doesn't match .${ext}.`);
  if (looksExecutable(bytes)) throw new AppError("VALIDATION", "Executable files are not allowed.");

  const ok =
    kind === "pdf"
      ? bytes.subarray(0, 1024).toString("latin1").includes("%PDF-")
      : kind === "docx" || kind === "xlsx"
        ? startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
          bytes.includes(Buffer.from(kind === "docx" ? "word/" : "xl/")) &&
          !bytes.includes(Buffer.from("vbaProject.bin")) // no macros
        : isUtf8Text(bytes);
  if (!ok) throw new AppError("VALIDATION", `The file content isn't a valid ${kind.toUpperCase()} file.`);
  return kind;
}
