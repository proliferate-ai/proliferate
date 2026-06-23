import { ExternalLink, RefreshCw } from "lucide-react";
import { useNavigate, type NavigateFunction } from "react-router-dom";

import {
  RedirectCallbackScreen,
  type RedirectCallbackAction,
} from "@proliferate/product-ui/auth/RedirectCallbackScreen";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";

import { routes } from "../../../config/routes";
import {
  type WebAuthErrorAction,
  webAuthErrorPresentation,
} from "../../../lib/domain/auth/web-auth-errors";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function AuthErrorScreen({ code }: { code: string | null }) {
  const navigate = useNavigate();
  const presentation = webAuthErrorPresentation(code);

  return (
    <RedirectCallbackScreen
      tone="error"
      title={presentation.title}
      description={presentation.description}
      statusLabel={presentation.statusLabel}
      brandMark={<ProliferateMark size={32} />}
      brandLabel={null}
      primaryAction={authErrorActionProps(presentation.primaryAction, navigate)}
      secondaryAction={
        presentation.secondaryAction
          ? authErrorActionProps(presentation.secondaryAction, navigate)
          : undefined
      }
    />
  );
}

function authErrorActionProps(
  action: WebAuthErrorAction,
  navigate: NavigateFunction,
): RedirectCallbackAction {
  switch (action.kind) {
    case "open_desktop":
      return {
        label: action.label,
        icon: <ExternalLink size={15} />,
        onClick: () => window.location.assign(desktopRootDeepLink()),
      };
    case "try_again":
      return {
        label: action.label,
        icon: <RefreshCw size={15} />,
        onClick: () => navigate(routes.auth),
      };
    case "go_home":
      return {
        label: action.label,
        onClick: () => navigate(routes.home),
      };
  }
}

function desktopRootDeepLink(): string {
  const scheme = LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate";
  return `${scheme}://`;
}
