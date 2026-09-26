"use client";

import { useState } from "react";
import { FlaskConical, Loader2, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { testToolAction } from "../actions";

export function ToolTester({ toolId, example, readOnly, simulated }: { toolId: string; example: Record<string, unknown>; readOnly: boolean; simulated: boolean }) {
  const [input, setInput] = useState(JSON.stringify(example, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<{ output: string; summary: string; simulated: boolean; latencyMs: number } | null>(null);
  const test = useAction(testToolAction, { refresh: true, onSuccess: setResult });

  function run(mode: "LIVE" | "SIMULATION") {
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      setParseError("Input must be valid JSON.");
      return;
    }
    setResult(null);
    void test.run({ toolId, input: parsed, mode });
  }

  return (
    <section className="h-fit rounded-xl border bg-surface p-5 shadow-card xl:sticky xl:top-24">
      <h2 className="text-card-title">Test tool</h2>
      <p className="text-[13px] text-text-secondary">Input is validated against the schema first.</p>
      {!readOnly && !simulated && (
        <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-text">
          <TriangleAlert className="size-4 shrink-0" aria-hidden /> A live test sends a real request to this API and may change data there. Use Simulate to check the request without sending it.
        </p>
      )}
      <Textarea className="mt-3 min-h-40 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Test input (JSON)" />
      {parseError && <p className="mt-1 text-xs text-danger-text">{parseError}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => run("SIMULATION")} disabled={test.pending}>
          <FlaskConical aria-hidden /> Simulate
        </Button>
        <Button onClick={() => run("LIVE")} disabled={test.pending}>
          {test.pending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Run {simulated ? "(simulated integration)" : "live"}
        </Button>
      </div>
      {result && (
        <div className="mt-4">
          <p className="text-[13px] font-medium">
            {result.summary} · {result.latencyMs} ms {result.simulated && <span className="text-ai">· simulated</span>}
          </p>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px]">{result.output}</pre>
        </div>
      )}
    </section>
  );
}
