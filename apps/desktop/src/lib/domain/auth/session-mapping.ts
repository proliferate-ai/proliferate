import type { AuthUser } from "@/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session";

export function authUserFromStoredSession(session: StoredAuthSession): AuthUser {
  return {
    id: session.user_id,
    email: session.email,
    display_name: session.display_name,
    github_login: session.github_login ?? null,
    avatar_url: session.avatar_url ?? null,
  };
}

export function storedSessionWithValidatedUser(
  session: StoredAuthSession,
  user: AuthUser,
): StoredAuthSession {
  return {
    ...session,
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    github_login: user.github_login ?? null,
    avatar_url: user.avatar_url ?? null,
  };
}
