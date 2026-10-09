"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDayKey, formatNumber } from "@/lib/format";

const axis = { stroke: "var(--text-muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, boxShadow: "var(--shadow-pop)" },
  labelStyle: { color: "var(--foreground)", fontWeight: 600 },
};

/** Clicks (left axis) and impressions (right axis) per day from Search Console. */
export function SearchTrendChart({ data }: { data: { date: string; clicks: number; impressions: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="siteClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatDayKey} minTickGap={28} {...axis} />
        <YAxis yAxisId="clicks" allowDecimals={false} width={44} tickFormatter={(v) => formatNumber(Number(v))} {...axis} />
        <YAxis yAxisId="impressions" orientation="right" allowDecimals={false} width={48} tickFormatter={(v) => formatNumber(Number(v))} {...axis} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => formatDayKey(String(l))} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Area yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="var(--brand)" strokeWidth={2} fill="url(#siteClicks)" isAnimationActive={false} />
        <Area yAxisId="impressions" type="monotone" dataKey="impressions" name="Impressions" stroke="var(--text-muted)" strokeWidth={1.5} fill="none" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Sessions and users per day from Google Analytics. */
export function TrafficTrendChart({ data }: { data: { date: string; sessions: number; users: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="siteSessions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatDayKey} minTickGap={28} {...axis} />
        <YAxis allowDecimals={false} width={44} tickFormatter={(v) => formatNumber(Number(v))} {...axis} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => formatDayKey(String(l))} formatter={(value, name) => [formatNumber(Number(value)), String(name)]} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="sessions" name="Sessions" stroke="var(--brand)" strokeWidth={2} fill="url(#siteSessions)" isAnimationActive={false} />
        <Area type="monotone" dataKey="users" name="Users" stroke="var(--text-muted)" strokeWidth={1.5} fill="none" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
