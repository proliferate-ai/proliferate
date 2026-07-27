import { Navigate, useLocation } from "react-router-dom";
import { PlaygroundIndex } from "#product/components/playground/PlaygroundIndex";

/**
 * Front door for the dev-only playground. Backward-compat: a `s` query
 * param on `/playground` is the old chat-gallery deep-link shape (the chat
 * gallery used to live at this path) — redirect to its new home at
 * `/playground/chat`, preserving the full query string so existing deep
 * links keep working.
 */
export function PlaygroundIndexPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (params.has("s")) {
    return <Navigate to={`/playground/chat${location.search}`} replace />;
  }

  return <PlaygroundIndex />;
}
