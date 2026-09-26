import { PageContainer, PageHeader } from "@/components/layout/page";
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Your company workspace, team, AI policies and integrations." />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <aside>
          <SettingsNav />
        </aside>
        <div className="min-w-0 max-w-4xl">{children}</div>
      </div>
    </PageContainer>
  );
}
