// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderBrandIcon } from "../src/auth/ProviderBrandIcon";

describe("ProviderBrandIcon", () => {
  afterEach(cleanup);

  it.each([
    ["Auth0", "auth0"],
    ["Okta", "okta"],
    ["Microsoft Entra", "microsoft"],
    ["GitLab", "gitlab"],
    ["Google Workspace", "google-sso"],
    ["Company SSO", "sso"],
  ])("maps %s SSO labels to the expected provider brand", (label, brand) => {
    const { container } = render(<ProviderBrandIcon provider="sso" label={label} />);

    expect(container.querySelector(`[data-auth-provider-brand="${brand}"]`)).toBeTruthy();
  });
});
