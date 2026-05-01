import type { ComponentType, ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

interface EnvironmentSectionProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<IconProps>;
  separated?: boolean;
  children: ReactNode;
}

interface EnvironmentFieldProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

interface EnvironmentPanelProps {
  children: ReactNode;
}

interface EnvironmentPanelRowProps {
  children: ReactNode;
}

interface EnvironmentAdvancedDisclosureProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function EnvironmentSection({
  title,
  description,
  action,
  icon: Icon,
  separated = false,
  children,
}: EnvironmentSectionProps) {
  return (
    <section className={`flex flex-col gap-4 ${separated ? "border-t border-border/60 pt-6" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
              <Icon className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-medium text-foreground">{title}</h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function EnvironmentField({
  label,
  description,
  children,
}: EnvironmentFieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? (
          <div className="text-sm text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function EnvironmentPanel({ children }: EnvironmentPanelProps) {
  return (
    <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border bg-foreground/5">
      {children}
    </div>
  );
}

export function EnvironmentPanelRow({ children }: EnvironmentPanelRowProps) {
  return <div className="p-3">{children}</div>;
}

export function EnvironmentAdvancedDisclosure({
  title,
  description,
  children,
}: EnvironmentAdvancedDisclosureProps) {
  return (
    <details className="group rounded-lg border border-border bg-foreground/5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-left [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 space-y-0.5">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          {description ? (
            <span className="block text-sm text-muted-foreground">{description}</span>
          ) : null}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border/40 p-3">{children}</div>
    </details>
  );
}
