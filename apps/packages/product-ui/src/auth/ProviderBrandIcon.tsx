import { useId } from "react";

import type { AuthProvider } from "@proliferate/product-domain/auth/model";
import { Mail, Shield } from "@proliferate/ui/icons";

export type AuthProviderIconKind = AuthProvider | "sso" | "password";

interface ProviderBrandIconProps {
  provider: AuthProviderIconKind;
  label?: string | null;
  className?: string;
}

export function ProviderBrandIcon({
  provider,
  label,
  className = "size-[18px]",
}: ProviderBrandIconProps) {
  if (provider === "github") {
    return <GitHubBrandMark className={className} />;
  }
  if (provider === "apple") {
    return <AppleBrandMark className={className} />;
  }
  if (provider === "sso") {
    return <SsoBrandMark label={label} className={className} />;
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

type SsoBrandKind =
  | "auth0"
  | "gitlab"
  | "google"
  | "microsoft"
  | "okta"
  | "sso";

function SsoBrandMark({
  label,
  className,
}: {
  label?: string | null;
  className: string;
}) {
  const brand = ssoBrandForLabel(label);
  if (brand === "auth0") {
    return <Auth0BrandMark className={className} />;
  }
  if (brand === "gitlab") {
    return <GitLabBrandMark className={className} />;
  }
  if (brand === "google") {
    return <GoogleBrandMark brand="google-sso" className={className} />;
  }
  if (brand === "microsoft") {
    return <MicrosoftBrandMark className={className} />;
  }
  if (brand === "okta") {
    return <OktaBrandMark className={className} />;
  }
  return (
    <Shield
      aria-hidden="true"
      data-auth-provider-brand="sso"
      className={className}
    />
  );
}

function ssoBrandForLabel(label: string | null | undefined): SsoBrandKind {
  const normalized = label
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim() ?? "";
  if (!normalized) {
    return "sso";
  }
  if (normalized.includes("auth0")) {
    return "auth0";
  }
  if (normalized.includes("gitlab")) {
    return "gitlab";
  }
  if (normalized.includes("google")) {
    return "google";
  }
  if (
    normalized.includes("microsoft")
    || normalized.includes("entra")
    || normalized.includes("azure")
  ) {
    return "microsoft";
  }
  if (normalized.includes("okta")) {
    return "okta";
  }
  return "sso";
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

function GoogleBrandMark({
  brand = "google",
  className,
}: {
  brand?: "google" | "google-sso";
  className: string;
}) {
  const pathId = `google-brand-path-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
  const clipPathId = `google-brand-clip-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;

  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand={brand}
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

function Auth0BrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="auth0"
      className={className}
      viewBox="0 0 64 64"
    >
      <path
        d="M49.012 51.774L42.514 32l17.008-12.22h-21.02L32.005 0h21.032l6.506 19.78c3.767 11.468-.118 24.52-10.53 31.993zm-34.023 0L31.998 64l17.015-12.226-17.008-12.22zm-10.516-32c-3.976 12.1.64 24.917 10.5 32.007v-.007L21.482 32 4.474 19.774l21.025.007L31.998 0H10.972z"
        fill="#eb5424"
      />
    </svg>
  );
}

function GitLabBrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="gitlab"
      className={className}
      viewBox="0 0 64 64"
      fillRule="evenodd"
    >
      <path d="M32 61.477L43.784 25.2H20.216z" fill="#e24329" />
      <path d="M32 61.477L20.216 25.2H3.7z" fill="#fc6d26" />
      <path d="M3.7 25.2L.12 36.23a2.44 2.44 0 0 0 .886 2.728L32 61.477z" fill="#fca326" />
      <path d="M3.7 25.2h16.515L13.118 3.366c-.365-1.124-1.955-1.124-2.32 0z" fill="#e24329" />
      <path d="M32 61.477L43.784 25.2H60.3z" fill="#fc6d26" />
      <path d="M60.3 25.2l3.58 11.02a2.44 2.44 0 0 1-.886 2.728L32 61.477z" fill="#fca326" />
      <path d="M60.3 25.2H43.784l7.098-21.844c.365-1.124 1.955-1.124 2.32 0z" fill="#e24329" />
    </svg>
  );
}

function MicrosoftBrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="microsoft"
      className={className}
      viewBox="0 0 32 32"
    >
      <path d="M0 0h15.206v15.206H0z" fill="#f25022" />
      <path d="M16.794 0H32v15.206H16.794z" fill="#7fba00" />
      <path d="M0 16.794h15.206V32H0z" fill="#00a4ef" />
      <path d="M16.794 16.794H32V32H16.794z" fill="#ffb900" />
    </svg>
  );
}

function OktaBrandMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      data-auth-provider-brand="okta"
      className={className}
      viewBox="0 0 64 64"
    >
      <path
        d="M32 0C14.37 0 0 14.267 0 32s14.268 32 32 32 32-14.268 32-32S49.63 0 32 0zm0 48c-8.866 0-16-7.134-16-16s7.134-16 16-16 16 7.134 16 16-7.134 16-16 16z"
        fill="#007dc1"
      />
    </svg>
  );
}
