import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { useOrgSlugSsoSignIn } from "@/hooks/auth/workflows/use-org-slug-sso-sign-in";
import { getRedirectTarget } from "@/lib/domain/auth/login-redirect";

// Org-scoped SSO entry point on cold login: a quiet "Sign in with SSO" link that
// reveals a workspace-slug field and drives the native SSO flow. Kept below the
// primary sign-in actions so it never disturbs the loading -> auth transition.
export function OrgSsoLoginLink() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, submitting, error, clearError } = useOrgSlugSsoSignIn();
  const [expanded, setExpanded] = useState(false);
  const [slug, setSlug] = useState("");

  async function handleSubmit() {
    if (submitting) {
      return;
    }
    const signedIn = await signIn(slug);
    if (signedIn) {
      navigate(getRedirectTarget(location.state), { replace: true });
    }
  }

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className="inline h-auto px-0 py-0 text-sm text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
      >
        Sign in with SSO
      </Button>
    );
  }

  return (
    <form
      className="grid w-full gap-2 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <Input
        value={slug}
        onChange={(event) => {
          setSlug(event.target.value);
          if (error) {
            clearError();
          }
        }}
        placeholder="your-organization"
        className="text-sm"
        disabled={submitting}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button
        type="submit"
        size="md"
        variant="secondary"
        className="h-11 w-full"
        loading={submitting}
        disabled={submitting || !slug.trim()}
      >
        {!submitting && <ProviderBrandIcon provider="sso" className="h-4 w-4 shrink-0" />}
        Continue with SSO
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
