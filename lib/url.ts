import { env } from "@/lib/env";

/**
 * An absolute URL on this app's public origin (APP_URL).
 *
 * Use it for redirects built in route handlers. Behind a reverse proxy such as Railway,
 * `request.url` carries the server's internal address (http://localhost:8080), and redirecting
 * there sends the browser somewhere it can't reach.
 */
export function appUrl(path: string): URL {
  return new URL(`${env().APP_URL}${path.startsWith("/") ? path : `/${path}`}`);
}
