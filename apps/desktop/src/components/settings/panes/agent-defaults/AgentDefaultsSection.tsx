import type { ReactNode } from "react";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";

export function AgentDefaultsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection title={title} description={description}>
      {children}
    </SettingsSection>
  );
}
