import { OrganizationAvatar } from "@/components/organizations/OrganizationAvatar";

interface OrganizationLogoRecord {
  name: string;
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
  return (
    <OrganizationAvatar
      name={organization.name}
      logoImage={logoImage}
      className="size-12"
    />
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
