import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe text renderer for agent output: paragraphs, bullet lists,
 * **bold**, `code` and [S1] citation chips. Never renders raw HTML.
 */
function inline(text: string, onCite?: (label: string) => ReactNode): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) parts.push(<strong key={i++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={i++} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px]">{token.slice(1, -1)}</code>);
    else parts.push(<Fragment key={i++}>{onCite ? onCite(token.slice(1, -1)) : token}</Fragment>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function RichText({ text, onCite, className }: { text: string; onCite?: (label: string) => ReactNode; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l) || !l.trim());
        if (isList) {
          return (
            <ul key={bi} className="my-1.5 list-disc space-y-1 pl-5">
              {lines
                .filter((l) => l.trim())
                .map((l, li) => (
                  <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), onCite)}</li>
                ))}
            </ul>
          );
        }
        if (/^#{1,4}\s/.test(block)) {
          return (
            <p key={bi} className="mb-1 mt-2 font-semibold">
              {inline(block.replace(/^#{1,4}\s/, ""), onCite)}
            </p>
          );
        }
        return (
          <p key={bi} className="my-1.5 whitespace-pre-line">
            {inline(block, onCite)}
          </p>
        );
      })}
    </div>
  );
}
