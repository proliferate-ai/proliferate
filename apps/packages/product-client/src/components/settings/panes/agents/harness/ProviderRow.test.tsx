// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderRow } from "#product/components/settings/panes/agents/harness/ProviderRow";
import type { ProviderRegistryEntry } from "#product/config/harness-env-vars";
import {
  productHostWrapper,
  makeTestProductHost,
} from "#product/test/product-host-test-utils";

afterEach(cleanup);

const anthropic: ProviderRegistryEntry = {
  id: "anthropic",
  displayName: "Anthropic",
  envVarNames: ["ANTHROPIC_API_KEY"],
  docsUrl: "https://docs.anthropic.com/",
  consoleUrl: "https://console.anthropic.com/",
};

const noLinks: ProviderRegistryEntry = {
  id: "obscure",
  displayName: "Obscure Cloud",
  envVarNames: ["OBSCURE_API_KEY"],
};

function renderRow(provider: ProviderRegistryEntry) {
  const host = makeTestProductHost();
  const openExternal = vi.spyOn(host.links, "openExternal").mockResolvedValue();
  render(
    <ProviderRow
      provider={provider}
      expanded
      configured={false}
      redactedHint={null}
      secret=""
      submitting={false}
      error={null}
      onToggle={() => {}}
      onSecretChange={() => {}}
      onConfirm={() => {}}
      onRemove={() => {}}
    />,
    { wrapper: productHostWrapper(host) },
  );
  return { openExternal };
}

describe("ProviderRow doc/console links (PRO-206)", () => {
  it("renders console and docs links and opens them externally", () => {
    const { openExternal } = renderRow(anthropic);
    fireEvent.click(screen.getByText("Get an API key"));
    expect(openExternal).toHaveBeenCalledWith("https://console.anthropic.com/");
    fireEvent.click(screen.getByText("Docs"));
    expect(openExternal).toHaveBeenCalledWith("https://docs.anthropic.com/");
  });

  it("falls back to plain guidance when the provider has no curated URLs", () => {
    renderRow(noLinks);
    expect(screen.getByText("Get an API key")).toBeTruthy();
    expect(screen.queryByText("Docs")).toBeNull();
  });
});
