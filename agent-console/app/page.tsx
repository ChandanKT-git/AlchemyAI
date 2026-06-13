/**
 * app/page.tsx — Root page (server component)
 *
 * This is a thin wrapper that imports the client-side AppShell.
 * The page itself is a server component (no "use client"),
 * which means it can be statically generated at build time.
 *
 * All interactive logic lives in AppShell and its children.
 */

import AppShell from "@/components/shell/AppShell";

export default function Home() {
  return <AppShell />;
}
