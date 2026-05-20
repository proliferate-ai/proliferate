import { RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen";

import { ProliferateMark } from "../components/app/navigation/ProliferateMark";
import { routes } from "../config/routes";

export function AuthErrorPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");

  return (
    <RedirectCallbackScreen
      tone="error"
      title="Sign in needs attention"
      description={
        code
          ? `The sign-in attempt could not be completed: ${code}`
          : "The sign-in attempt could not be completed. Return to the app and try again."
      }
      statusLabel="Auth error"
      brandMark={<ProliferateMark size={32} />}
      primaryAction={{
        label: "Try again",
        icon: <RefreshCw size={15} />,
        onClick: () => navigate(routes.auth),
      }}
      secondaryAction={{
        label: "Go to dashboard",
        onClick: () => navigate(routes.home),
      }}
    />
  );
}
