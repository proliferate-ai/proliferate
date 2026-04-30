import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";

interface SettingsPageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SettingsPageHeader({
  title,
  description,
  action,
}: SettingsPageHeaderProps) {
  return <PageHeader title={title} description={description} action={action} />;
}
