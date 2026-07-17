import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";

/**
 * Router-state key carrying a decoded org-SSO slug from `/login/:slug` into the
 * shared ProductClient login screen. ProductClient's login owns the SSO form and
 * calls `host.auth.startLogin({ kind: "sso", slug })`; this host route only
 * decodes and seeds the intent, it renders no login UI of its own.
 */
export const SSO_LOGIN_SLUG_STATE_KEY = "ssoSlug";

export interface SsoLoginEntryState {
  [SSO_LOGIN_SLUG_STATE_KEY]?: string;
}

/**
 * The narrow `/login/:slug` host route. It decodes the org slug and redirects to
 * the shared `/login` screen, seeding the slug as login intent in router state.
 * A missing/blank slug seeds nothing and just lands on the shared login screen.
 */
export function SsoLoginEntryRoute() {
  const { slug } = useParams();
  const state = useMemo<SsoLoginEntryState | undefined>(() => {
    const trimmed = slug?.trim();
    return trimmed ? { [SSO_LOGIN_SLUG_STATE_KEY]: trimmed } : undefined;
  }, [slug]);
  return <Navigate to="/login" replace state={state} />;
}
