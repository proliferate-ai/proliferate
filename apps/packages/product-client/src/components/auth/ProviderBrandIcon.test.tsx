// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderBrandIcon } from "#product/components/auth/ProviderBrandIcon";

describe("ProviderBrandIcon", () => {
  afterEach(cleanup);

  it("uses the primary provider-identity tier by default", () => {
    const { container } = render(<ProviderBrandIcon provider="github" />);

    expect(container.querySelector('[data-auth-provider-brand="github"]')?.getAttribute("class"))
      .toContain("icon-control");
  });
});
