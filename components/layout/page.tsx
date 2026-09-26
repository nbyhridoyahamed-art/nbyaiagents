import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Standard page container: max 1600px wide, spec paddings (16 / 24 / 28×32). */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6 md:py-6 lg:px-8 lg:pb-12 lg:pt-7", className)}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-1 text-brand">{eyebrow}</p>}
        <h1 className="text-[26px] font-[650] leading-9 tracking-tight lg:text-page-title">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-section-title">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
