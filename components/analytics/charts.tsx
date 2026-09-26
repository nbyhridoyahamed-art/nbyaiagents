"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/server/services/analytics";
import { formatDayKey, formatNumber, formatUsd } from "@/lib/format";

const axis = { stroke: "var(--text-muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, boxShadow: "var(--shadow-pop)" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
  cursor: { fill: "var(--surface-2)" },
};

/** Executions per day: succeeded / failed / other (cancelled, waiting…). */
export function ExecutionsChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap={data.length > 40 ? 1 : 4}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={formatDayKey} minTickGap={24} {...axis} />
        <YAxis allowDecimals={false} width={40} {...axis} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => formatDayKey(String(l))} />
        <Bar dataKey="succeeded" name="Succeeded" stackId="a" fill="var(--success)" isAnimationActive={false} />
        <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--danger)" isAnimationActive={false} />
        <Bar dataKey="other" name="Other" stackId="a" fill="var(--border-strong)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Estimated AI cost per day (tokens shown in the tooltip). */
export function CostChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="day" tickFormatter={formatDayKey} minTickGap={24} {...axis} />
        <YAxis width={52} tickFormatter={(v) => `$${Number(v).toFixed(v >= 10 ? 0 : 2)}`} {...axis} />
        <Tooltip
          {...tooltipStyle}
          labelFormatter={(l) => formatDayKey(String(l))}
          formatter={(value, name, item) => {
            if (name === "costUsd") return [`${formatUsd(Number(value))} · ${formatNumber((item.payload as DailyPoint).tokens)} tokens`, "Est. cost"];
            return [String(value), String(name)];
          }}
        />
        <Area type="monotone" dataKey="costUsd" stroke="var(--brand)" strokeWidth={2} fill="url(#costFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
