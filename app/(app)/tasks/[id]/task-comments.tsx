"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { addCommentAction } from "../actions";

export function TaskComments({ taskId, canWrite, comments }: { taskId: string; canWrite: boolean; comments: { id: string; body: string; author: string; createdAt: string }[] }) {
  const [body, setBody] = useState("");
  const add = useAction(addCommentAction, { onSuccess: () => setBody("") });
  return (
    <section className="rounded-xl border bg-surface p-5 shadow-card" aria-labelledby="comments-title">
      <h2 id="comments-title" className="text-card-title">
        Comments
      </h2>
      <ul className="mt-3 grid gap-3">
        {comments.length === 0 && <li className="text-[13px] text-text-muted">No comments yet.</li>}
        {comments.map((c) => (
          <li key={c.id}>
            <p className="text-xs text-text-muted">
              <span className="font-medium text-foreground">{c.author}</span> · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[13.5px]">{c.body}</p>
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add.run({ taskId, body });
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team" rows={2} aria-label="Comment" />
          <Button type="submit" size="sm" className="justify-self-end" disabled={add.pending || !body.trim()}>
            {add.pending && <Loader2 className="animate-spin" aria-hidden />} Comment
          </Button>
        </form>
      )}
    </section>
  );
}
