import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div>
      <div className="rounded-2xl border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="font-heading text-[24px] font-semibold leading-8 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-text-secondary">{subtitle}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
      {footer && <div className="mt-5 text-center text-[13px] text-text-secondary">{footer}</div>}
    </div>
  );
}
