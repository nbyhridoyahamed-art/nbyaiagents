import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-6 py-5">
        <Link href="/" aria-label="NBY AI Agents home">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
      <footer className="px-6 py-5 text-center text-xs text-text-muted">
        One person. One company. An AI workforce.
      </footer>
    </div>
  );
}
