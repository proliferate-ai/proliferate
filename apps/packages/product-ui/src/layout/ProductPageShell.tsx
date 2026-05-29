import { type ReactNode } from "react";
import { PageContentFrame } from "@proliferate/ui/layout/PageContentFrame";
import { PageHeader } from "@proliferate/ui/layout/PageHeader";

interface ProductPageShellProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
  telemetryBlocked?: boolean;
}

export function ProductPageShell({
  title,
  description,
  actions,
  children,
  maxWidthClassName = "max-w-3xl",
  telemetryBlocked = false,
}: ProductPageShellProps) {
  const shell = (
    <PageContentFrame
      maxWidthClassName={maxWidthClassName}
      stickyTitle={typeof title === "string" ? title : undefined}
      header={<PageHeader title={title} description={description} actions={actions} className="px-0 py-0 border-b-0" />}
    >
      {children}
    </PageContentFrame>
  );

  if (!telemetryBlocked) {
    return shell;
  }

  return (
    <div className="contents" data-telemetry-block>
      {shell}
    </div>
  );
}
