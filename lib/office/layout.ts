/**
 * Deterministic layout for the AI Office map: departments are rooms laid out in a
 * grid, employees sit inside their room, workflows form a lane to the right,
 * ordered to sit near the employees they involve (fewer crossing lines).
 */

export const AGENT_W = 220;
export const AGENT_H = 108;
export const WORKFLOW_W = 210;
export const WORKFLOW_H = 58;
const GAP = 18;
const PAD = 20;
const HEADER = 46;
const ROOM_GAP = 48;
const LANE_GAP = 140;
const WORKFLOW_GAP = 22;

export interface LayoutInput {
  rooms: { id: string; agentIds: string[] }[];
  workflows: { id: string; agentIds: string[] }[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OfficeLayout {
  rooms: Record<string, Box>;
  /** Positions relative to the agent's room. */
  agents: Record<string, Box>;
  /** Absolute positions (for edge routing). */
  agentsAbsolute: Record<string, Box>;
  workflows: Record<string, Box>;
  width: number;
  height: number;
}

export function layoutOffice(input: LayoutInput, maxRoomColumns = 2): OfficeLayout {
  const roomColumns = Math.max(1, Math.min(maxRoomColumns, input.rooms.length));
  const rooms: Record<string, Box> = {};
  const agents: Record<string, Box> = {};
  const agentsAbsolute: Record<string, Box> = {};

  const sizes = input.rooms.map((r) => {
    const cols = Math.max(1, Math.min(2, r.agentIds.length));
    const rows = Math.max(1, Math.ceil(r.agentIds.length / cols));
    return {
      cols,
      width: PAD * 2 + cols * AGENT_W + (cols - 1) * GAP,
      height: HEADER + PAD + rows * AGENT_H + (rows - 1) * GAP + PAD,
    };
  });
  const colWidths = Array.from({ length: roomColumns }, (_, c) => Math.max(0, ...sizes.filter((_, i) => i % roomColumns === c).map((s) => s.width)));

  let y = 0;
  for (let rowStart = 0; rowStart < input.rooms.length; rowStart += roomColumns) {
    const rowRooms = input.rooms.slice(rowStart, rowStart + roomColumns);
    const rowHeight = Math.max(...rowRooms.map((_, i) => sizes[rowStart + i].height));
    let x = 0;
    rowRooms.forEach((room, i) => {
      const size = sizes[rowStart + i];
      rooms[room.id] = { x, y, width: size.width, height: rowHeight };
      room.agentIds.forEach((id, k) => {
        const rel = { x: PAD + (k % size.cols) * (AGENT_W + GAP), y: HEADER + Math.floor(k / size.cols) * (AGENT_H + GAP), width: AGENT_W, height: AGENT_H };
        agents[id] = rel;
        agentsAbsolute[id] = { ...rel, x: rel.x + x, y: rel.y + y };
      });
      x += colWidths[i] + ROOM_GAP;
    });
    y += rowHeight + ROOM_GAP;
  }
  const roomsRight = input.rooms.length ? colWidths.reduce((s, w) => s + w, 0) + ROOM_GAP * (roomColumns - 1) : 0;
  const roomsBottom = Math.max(0, y - ROOM_GAP);

  // Workflows: sort by the average vertical position of their employees, then stack.
  const workflows: Record<string, Box> = {};
  const centerY = (w: { agentIds: string[] }) => {
    const ys = w.agentIds.map((id) => agentsAbsolute[id]).filter(Boolean).map((b) => b.y + b.height / 2);
    return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : Number.MAX_SAFE_INTEGER;
  };
  const ordered = [...input.workflows].sort((a, b) => centerY(a) - centerY(b));
  const laneX = input.rooms.length ? roomsRight + LANE_GAP : 0;
  const laneHeight = ordered.length * WORKFLOW_H + Math.max(0, ordered.length - 1) * WORKFLOW_GAP;
  let wy = Math.max(0, (roomsBottom - laneHeight) / 2);
  for (const w of ordered) {
    workflows[w.id] = { x: laneX, y: wy, width: WORKFLOW_W, height: WORKFLOW_H };
    wy += WORKFLOW_H + WORKFLOW_GAP;
  }

  return {
    rooms,
    agents,
    agentsAbsolute,
    workflows,
    width: ordered.length ? laneX + WORKFLOW_W : roomsRight,
    height: Math.max(roomsBottom, wy - WORKFLOW_GAP),
  };
}

export type Side = "t" | "r" | "b" | "l";

/** Which sides of two boxes to connect so lines leave and enter facing each other. */
export function facingSides(a: Box, b: Box): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy) * 0.8) return dx >= 0 ? ["r", "l"] : ["l", "r"];
  return dy >= 0 ? ["b", "t"] : ["t", "b"];
}
