import { useState } from "react";
import { useParams } from "react-router-dom";

import { AuthLayout } from "@proliferate/product-ui/auth/AuthLayout";
import { ProviderBrandIcon } from "@proliferate/product-ui/auth/ProviderBrandIcon";
import { ProliferateMark } from "@proliferate/product-ui/brand/ProliferateMark";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";

import { startWebSsoFlowForSlug } from "../lib/access/cloud/auth/web-auth-flow";

// Org-scoped SSO entry point. Reached from the "Sign in with SSO" link on the
// auth screen, or directly via /login/<slug> links an admin shares. The slug
// resolves to the org's SSO connection server-side; a slug that does not
// resolve returns a generic answer, so we never confirm which orgs exist.
export function LoginSsoPage() {
  const { slug: slugParam } = useParams();
  const [slug, setSlug] = useState(slugParam ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await startWebSsoFlowForSlug(slug);
    } catch (ssoError) {
      setSubmitting(false);
      setError(ssoError instanceof Error ? ssoError.message : "SSO could not start.");
    }
  }

  return (
    <AuthLayout
      mark={<ProliferateMark size={36} />}
      title="Sign in with SSO"
      subtitle="Enter your organization's workspace name to continue to your identity provider."
    >
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <Input
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
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
          className="w-full"
          loading={submitting}
          disabled={submitting || !slug.trim()}
        >
          <ProviderBrandIcon provider="sso" className="size-[15px]" />
          Continue
        </Button>
      </form>
      {error ? (
        <p className="text-sm leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </AuthLayout>
  );
}
