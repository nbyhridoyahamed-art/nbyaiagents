/**
 * Chunking: split on headings and paragraphs, pack into ~target-sized chunks
 * with overlap, and keep page numbers and the nearest heading as metadata.
 */
export interface Chunk {
  index: number;
  content: string;
  heading: string | null;
  pageNumber: number | null;
  tokenCount: number;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function chunkPages(pages: { page: number | null; text: string }[], opts: { targetChars?: number; overlapChars?: number } = {}): Chunk[] {
  const target = opts.targetChars ?? 2400;
  const overlap = opts.overlapChars ?? 300;
  const chunks: Chunk[] = [];
  let heading: string | null = null;

  for (const { page, text } of pages) {
    const paragraphs = text.split(/\n{2,}|\n(?=#{1,6}\s)/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    const flush = () => {
      const content = buf.trim();
      if (content.length >= 20) chunks.push({ index: chunks.length, content, heading, pageNumber: page, tokenCount: estimateTokens(content) });
      buf = content.length > overlap ? content.slice(-overlap) : "";
    };
    for (const para of paragraphs) {
      const h = /^#{1,6}\s+(.+)$/.exec(para.split("\n")[0]);
      if (h) heading = h[1].slice(0, 200);
      if (para.length > target) {
        // Very long paragraph: split on sentence boundaries.
        for (const sentence of para.split(/(?<=[.!?])\s+/)) {
          if (buf.length + sentence.length > target) flush();
          buf += `${sentence} `;
        }
        continue;
      }
      if (buf.length + para.length + 2 > target) flush();
      buf += `${para}\n\n`;
    }
    if (buf.trim().length > overlap || chunks.length === 0 || chunks[chunks.length - 1].pageNumber !== page) flush();
    buf = "";
  }
  return chunks;
}
