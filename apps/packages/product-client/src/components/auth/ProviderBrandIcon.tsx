import { useId } from "react";

import type { AuthProvider } from "#product/domain/auth/model";
import { Mail } from "#product/primitives/icons/platform";

export type AuthProviderIconKind = AuthProvider | "password";

interface ProviderBrandIconProps {
  provider: AuthProviderIconKind;
  className?: string;
}

export function ProviderBrandIcon({
  provider,
  className = "icon-control",
}: ProviderBrandIconProps) {
  if (provider === "github") {
    return <GitHubBrandMark className={className} />;
  }
  if (provider === "apple") {
    return <AppleBrandMark className={className} />;
  }
  if (provider === "password") {
    return (
      <Mail
        aria-hidden="true"
        data-auth-provider-brand="password"
        className={className}
      />
    );
  }
  return <GoogleBrandMark className={className} />;
}

function GitHubBrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="github"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 .3C5.4.3 0 5.7 0 12.3c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.8-1.6 8.2-6.1 8.2-11.4C24 5.7 18.6.3 12 .3Z" />
    </svg>
  );
}

function AppleBrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="apple"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M16.8 12.7c0-2.8 2.3-4.2 2.4-4.3-1.3-1.9-3.4-2.2-4.1-2.2-1.8-.2-3.4 1-4.3 1-.9 0-2.2-1-3.7-1-1.9 0-3.7 1.1-4.7 2.8-2 3.5-.5 8.6 1.4 11.4 1 1.4 2.1 2.9 3.6 2.9 1.4-.1 2-.9 3.7-.9s2.2.9 3.7.9c1.5 0 2.5-1.4 3.5-2.8 1.1-1.6 1.5-3.1 1.6-3.2 0-.1-3.1-1.2-3.1-4.6ZM13.9 4.4c.8-.9 1.3-2.2 1.2-3.5-1.1 0-2.5.8-3.3 1.7-.7.8-1.3 2.1-1.2 3.4 1.3.1 2.5-.6 3.3-1.6Z" />
    </svg>
  );
}

function GoogleBrandMark({ className }: { className: string }) {
  const pathId = `google-brand-path-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const clipPathId = `google-brand-clip-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;

  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="google"
      className={className}
      viewBox="0 0 32 32"
    >
      <defs>
        <path
          id={pathId}
          d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"
        />
      </defs>
      <clipPath id={clipPathId}>
        <use href={`#${pathId}`} />
      </clipPath>
      <g transform="matrix(.727273 0 0 .727273 -.954545 -1.45455)">
        <path d="M0 37V11l17 13z" clipPath={`url(#${clipPathId})`} fill="#fbbc05" />
        <path d="M0 11l17 13 7-6.1L48 14V0H0z" clipPath={`url(#${clipPathId})`} fill="#ea4335" />
        <path d="M0 37l30-23 7.9 1L48 0v48H0z" clipPath={`url(#${clipPathId})`} fill="#34a853" />
        <path d="M48 48L17 24l-4-3 35-10z" clipPath={`url(#${clipPathId})`} fill="#4285f4" />
      </g>
    </svg>
  );
}
