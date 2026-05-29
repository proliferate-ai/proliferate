import type { ReactNode } from "react";

interface OrganizationLogoRecord {
  name: string;
  logoDomain?: string | null;
}

interface OrganizationAvatarMember {
  displayName?: string | null;
  email: string;
  avatarUrl?: string | null;
}

export function OrganizationLogo({
  organization,
  logoImage,
}: {
  organization: OrganizationLogoRecord;
  logoImage?: string | null;
}) {
  const initials = organization.name.trim().slice(0, 2).toUpperCase() || "OR";
  if (logoImage) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-light bg-foreground/5">
        <img src={logoImage} alt="" className="size-full object-cover" />
      </div>
    );
  }
  if (!organization.logoDomain) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border-light bg-foreground/5 text-sm font-medium text-muted-foreground">
        {initials}
      </div>
    );
  }
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(organization.logoDomain)}&sz=64`;
  return (
    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-light bg-foreground/5">
      <img src={faviconUrl} alt="" className="size-6" />
    </div>
  );
}

export function Avatar({ member }: { member: OrganizationAvatarMember }) {
  const initials = (member.displayName || member.email).trim().slice(0, 2).toUpperCase();
  if (member.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt=""
        className="size-8 rounded-full bg-foreground/5 object-cover"
      />
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-light bg-foreground/5 text-xs font-medium text-muted-foreground">
      {initials || "U"}
    </div>
  );
}

export function OrganizationSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
