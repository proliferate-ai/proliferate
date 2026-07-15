import { twMerge } from "@proliferate/ui/utils/tw-merge";

/**
 * Two-letter monogram for an organization, uppercased. Falls back to "OR" so an
 * empty name never renders a blank tile.
 */
export function organizationInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "OR";
}

/**
 * The single org avatar used across every surface (sidebar switcher, settings
 * profile). Renders the uploaded logo when present, otherwise a clean initials
 * monogram on a neutral token background so all fallbacks match. Size is set by
 * the caller via `className` (e.g. `size-5`, `size-12`).
 */
export function OrganizationAvatar({
  name,
  logoImage,
  className,
}: {
  name: string;
  logoImage?: string | null;
  className?: string;
}) {
  const baseClassName = twMerge(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-light bg-foreground/5 text-ui-sm font-medium leading-none text-muted-foreground",
    className,
  );

  if (logoImage) {
    return (
      <span className={baseClassName}>
        <img src={logoImage} alt="" className="size-full object-cover" />
      </span>
    );
  }

  return <span className={baseClassName}>{organizationInitials(name)}</span>;
}
