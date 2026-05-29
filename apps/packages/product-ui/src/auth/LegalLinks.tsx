import { type AnchorHTMLAttributes } from "react";

interface LegalLinksProps {
  termsHref: string;
  privacyHref: string;
  linkProps?: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;
}

export function LegalLinks({ termsHref, privacyHref, linkProps }: LegalLinksProps) {
  return (
    <span>
      By continuing you agree to our{" "}
      <a className="text-muted-foreground underline underline-offset-2" href={termsHref} {...linkProps}>
        Terms of Service
      </a>{" "}
      and{" "}
      <a className="text-muted-foreground underline underline-offset-2" href={privacyHref} {...linkProps}>
        Privacy Policy
      </a>
      .
    </span>
  );
}
