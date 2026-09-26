import { describe, expect, it } from "vitest";
import { AGENT_W, facingSides, layoutOffice } from "@/lib/office/layout";

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("AI Office layout", () => {
  const input = {
    rooms: [
      { id: "sales", agentIds: ["sarah"] },
      { id: "marketing", agentIds: ["alex", "david", "olivia", "liam"] },
      { id: "support", agentIds: ["emma"] },
    ],
    workflows: [
      { id: "report", agentIds: ["david"] },
      { id: "lead", agentIds: ["sarah"] },
      { id: "support", agentIds: ["emma"] },
      { id: "orphan", agentIds: [] },
    ],
  };
  const l = layoutOffice(input);

  it("keeps every employee inside its room and rooms apart", () => {
    for (const room of input.rooms) {
      const r = l.rooms[room.id];
      for (const id of room.agentIds) {
        const a = l.agentsAbsolute[id];
        expect(a.x).toBeGreaterThanOrEqual(r.x);
        expect(a.x + a.width).toBeLessThanOrEqual(r.x + r.width);
        expect(a.y + a.height).toBeLessThanOrEqual(r.y + r.height);
      }
    }
    const ids = Object.keys(l.rooms);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(overlaps(l.rooms[ids[i]], l.rooms[ids[j]])).toBe(false);
    expect(l.rooms.marketing.width).toBeGreaterThan(2 * AGENT_W);
  });

  it("places workflows in a lane to the right, near their employees, without overlaps", () => {
    const lane = Object.values(l.workflows);
    const roomsRight = Math.max(...Object.values(l.rooms).map((r) => r.x + r.width));
    expect(lane.every((w) => w.x > roomsRight)).toBe(true);
    expect(l.workflows.lead.y).toBeLessThan(l.workflows.support.y); // Sarah's room is above Emma's
    expect(l.workflows.orphan.y).toBeGreaterThan(l.workflows.support.y); // unconnected ones go last
    for (let i = 0; i < lane.length; i++) for (let j = i + 1; j < lane.length; j++) expect(overlaps(lane[i], lane[j])).toBe(false);
  });

  it("is deterministic and handles an empty office", () => {
    expect(layoutOffice(input)).toEqual(l);
    expect(layoutOffice({ rooms: [], workflows: [] })).toMatchObject({ width: 0, height: 0 });
  });

  it("connects facing sides", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    expect(facingSides(a, { x: 300, y: 10, width: 100, height: 50 })).toEqual(["r", "l"]);
    expect(facingSides(a, { x: -300, y: 0, width: 100, height: 50 })).toEqual(["l", "r"]);
    expect(facingSides(a, { x: 0, y: 300, width: 100, height: 50 })).toEqual(["b", "t"]);
  });
});
