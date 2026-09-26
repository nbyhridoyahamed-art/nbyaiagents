import { Logo } from "@/components/brand/logo";

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16 pt-4">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
    </div>
  );
}
