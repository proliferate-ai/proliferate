import type { ReactNode } from "react";
import type {
  OrganizationMemberResponse,
  OrganizationResponse,
} from "@/lib/integrations/cloud/client";

export function OrganizationLogo({
  organization,
  logoImage,
}: {
  organization: OrganizationResponse;
  logoImage?: string | null;
}) {
  const initials = organization.name.trim().slice(0, 2).toUpperCase() || "OR";
  if (logoImage) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground/5">
        <img src={logoImage} alt="" className="size-full object-cover" />
      </div>
    );
  }
  if (!organization.logoDomain) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-sm font-medium">
        {initials}
      </div>
    );
  }
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(organization.logoDomain)}&sz=64`;
  return (
    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground/5">
      <img src={faviconUrl} alt="" className="size-6" />
    </div>
  );
}

export function Avatar({ member }: { member: OrganizationMemberResponse }) {
  const initials = (member.displayName || member.email).trim().slice(0, 2).toUpperCase();
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        className="size-8 rounded-full bg-foreground/5"
      />
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-xs font-medium">
      {initials || "U"}
    </div>
  );
}

export function OrganizationSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}
