import { Apple, Github, KeyRound } from "lucide-react";
import { useState } from "react";

import { AuthLayout } from "@proliferate/product-ui/auth/AuthLayout";
import { AuthProviderButton } from "@proliferate/product-ui/auth/AuthProviderButton";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { useAuthToken } from "../../../providers/WebCloudProvider";
import { ProliferateMark } from "../../app/navigation/ProliferateMark";

export function AuthScreen() {
  const { setToken } = useAuthToken();
  const [manualToken, setManualToken] = useState("");
  const [showDevAccess, setShowDevAccess] = useState(false);

  return (
    <AuthLayout
      mark={<ProliferateMark size={36} />}
      title={<span className="text-2xl tracking-tight">Proliferate</span>}
      subtitle="Run and orchestrate coding agents."
      footer={
        <span className="block text-faint">
          By continuing you agree to the Proliferate
          <br />
          Terms and Privacy Policy.
        </span>
      }
    >
      <AuthProviderButton
        icon={<Github size={18} />}
        disabled
        title="GitHub browser sign-in is wired in the auth implementation PR."
      >
        Continue with GitHub
      </AuthProviderButton>
      <AuthProviderButton
        icon={<Apple size={18} />}
        disabled
        title="Apple sign-in is wired in the auth implementation PR."
      >
        Continue with Apple
      </AuthProviderButton>

      <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
        A GitHub connection is required to run cloud workspaces and automations.
      </p>

      <div className="mt-2 border-t border-border pt-4">
        {showDevAccess ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <KeyRound size={12} />
              Development access
            </div>
            <Input
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Paste a development access token"
              className="text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDevAccess(false);
                  setManualToken("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!manualToken.trim()}
                onClick={() => setToken(manualToken.trim())}
              >
                Use token
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            onClick={() => setShowDevAccess(true)}
            className="block w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Use a development access token
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
