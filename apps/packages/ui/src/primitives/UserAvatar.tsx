import { useState } from "react";
import { twMerge } from "../utils/tw-merge";

/**
 * Initials for a person's display name/email, uppercased. Prefers the first
 * letter of the first two whitespace-separated words (e.g. "Jane Doe" -> "JD");
 * falls back to the first two characters of a single word/email, then to "PR"
 * when there is nothing to initial.
 */
export function userInitials(displayName: string): string {
  const parts = displayName
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase() || "PR";
  }
  return (parts[0]?.slice(0, 2) || "PR").toUpperCase();
}

/**
 * The single person avatar, sibling to `OrganizationAvatar`: renders the
 * user's image when present, otherwise a clean initials monogram on a
 * neutral token background so every fallback matches. Size is set by the
 * caller via `className` (e.g. `size-7`, `size-16`), same convention as
 * `OrganizationAvatar`. Falls back to initials if the image fails to load
 * (broken URL, revoked auth, etc.) — this replaces the `avatarFailed` state
 * previously hand-rolled per call site.
 */
export function UserAvatar({
  displayName,
  avatarUrl,
  className,
}: {
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;

  const baseClassName = twMerge(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-light bg-surface-control text-ui-sm font-medium leading-none text-muted-foreground",
    className,
  );

  if (showAvatar) {
    return (
      <span className={baseClassName}>
        <img
          src={avatarUrl ?? ""}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setAvatarFailed(true)}
        />
      </span>
    );
  }

  return <span className={baseClassName}>{userInitials(displayName)}</span>;
}
