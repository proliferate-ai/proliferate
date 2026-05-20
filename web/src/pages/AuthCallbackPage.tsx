import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

import { ProliferateMark } from "../components/app/navigation/ProliferateMark";
import { routes } from "../config/routes";
import { completeWebAuthFlow } from "../lib/access/cloud/auth/web-auth-flow";
import { useAuthToken } from "../providers/WebCloudProvider";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setSession } = useAuthToken();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    completeWebAuthFlow(searchParams)
      .then((session) => {
        setSession(session);
        navigate(routes.home, { replace: true });
      })
      .catch((callbackError) => {
        const message =
          callbackError instanceof Error
            ? callbackError.message
            : "The sign-in callback could not be completed.";
        setError(message);
        navigate(`${routes.authError}?code=${encodeURIComponent(message)}`, {
          replace: true,
        });
      });
  }, [navigate, searchParams, setSession]);

  return (
    <RedirectCallbackScreen
      tone={error ? "error" : "neutral"}
      title={error ? "Sign in needs attention" : "Finishing sign in"}
      description={
        error ??
        "Your browser session is being created. You will be redirected when it is ready."
      }
      statusLabel={error ? "Auth error" : "Exchanging auth code"}
      brandMark={<ProliferateMark size={32} />}
    />
  );
}
