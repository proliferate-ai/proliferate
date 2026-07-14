import type { ProductAuthUser } from "@proliferate/product-client/host/product-host";
import type { AuthUser } from "@/lib/domain/auth/auth-user";

/** Adapt the normalized ProductHost identity for legacy pure Desktop rules. */
export function productAuthUserToDesktopUser(user: ProductAuthUser | null): AuthUser | null {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email ?? "",
    display_name: user.displayName ?? null,
    github_login: user.githubLogin ?? null,
    avatar_url: user.avatarUrl ?? null,
  };
}
