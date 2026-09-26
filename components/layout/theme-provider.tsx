"use client";

import type { ComponentProps } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes renders an inline script that sets the theme before first paint.
 * React 19 warns when a client render encounters an executable <script>, so on
 * the client the script is marked inert; the server-rendered copy still runs.
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  const scriptProps = typeof window === "undefined" ? undefined : ({ type: "application/json" } as const);
  return <NextThemesProvider {...props} scriptProps={scriptProps} />;
}
