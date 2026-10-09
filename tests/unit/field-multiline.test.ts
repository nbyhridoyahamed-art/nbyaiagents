import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { Field } from "@/components/forms/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Every element of one component type anywhere in an element tree (Field has no hooks, so it can be called directly). */
function findAll(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, type));
  const element = node as ReactElement<{ children?: ReactNode }>;
  const here = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
  return [...here, ...findAll(element.props?.children, type)];
}

describe("Field", () => {
  it("tells the form what was typed into a multiline box", () => {
    const onChange = vi.fn();
    const [textarea] = findAll(Field({ label: "Content", name: "content", multiline: true, onChange }), Textarea);

    expect(textarea).toBeDefined();
    expect(textarea.props.onChange).toBeTypeOf("function");
    const event = { target: { value: "a new document" } };
    (textarea.props.onChange as (e: unknown) => void)(event);
    expect(onChange).toHaveBeenCalledWith(event);
  });

  it("still hands a multiline box its other settings", () => {
    const [textarea] = findAll(Field({ label: "Details", name: "description", multiline: true, rows: 5, defaultValue: "Hello", placeholder: "Say more", maxLength: 500, required: true }), Textarea);
    expect(textarea.props).toMatchObject({ rows: 5, defaultValue: "Hello", placeholder: "Say more", maxLength: 500, required: true, name: "description", id: "field-description" });
  });

  it("keeps passing everything to a single-line input", () => {
    const onChange = vi.fn();
    const [input] = findAll(Field({ label: "Title", name: "title", value: "x", onChange }), Input);
    expect(input.props).toMatchObject({ value: "x", onChange, name: "title" });
  });

  it("ties an error to its field", () => {
    const [textarea] = findAll(Field({ label: "Content", name: "content", multiline: true, error: "Write at least a couple of sentences." }), Textarea);
    expect(textarea.props["aria-invalid"]).toBe(true);
    expect(textarea.props["aria-describedby"]).toBe("field-content-error");
  });
});
