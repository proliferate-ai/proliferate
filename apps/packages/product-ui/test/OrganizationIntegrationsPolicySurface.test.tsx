// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationIntegrationsPolicySurface } from "../src/plugins/OrganizationIntegrationsPolicySurface";
import type { OrganizationIntegrationPolicyItem } from "../src/plugins/OrganizationIntegrationsPolicySurface";

describe("OrganizationIntegrationsPolicySurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the integration category picker style for filters", () => {
    const onCategoryFilterChange = vi.fn();

    render(
      <OrganizationIntegrationsPolicySurface
        items={[policyItem()]}
        query=""
        categoryFilter="all"
        loading={false}
        error={null}
        pendingCatalogEntryIds={[]}
        onQueryChange={vi.fn()}
        onCategoryFilterChange={onCategoryFilterChange}
        onToggleIntegration={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter integrations: All" }));

    expect(screen.getByPlaceholderText("Search")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "obs" } });
    expect(screen.getByRole("button", { name: "Observability" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Knowledge" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Observability" }));

    expect(onCategoryFilterChange).toHaveBeenCalledWith("observability");
  });

  it("renders category and MCP tags on policy rows", () => {
    render(
      <OrganizationIntegrationsPolicySurface
        items={[policyItem()]}
        query=""
        categoryFilter="all"
        loading={false}
        error={null}
        pendingCatalogEntryIds={[]}
        onQueryChange={vi.fn()}
        onCategoryFilterChange={vi.fn()}
        onToggleIntegration={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Source control")).toBeTruthy();
    expect(screen.getByText("MCP")).toBeTruthy();
  });
});

function policyItem(): OrganizationIntegrationPolicyItem {
  return {
    catalogEntryId: "github",
    name: "GitHub",
    description: "GitHub integration",
    iconId: "github",
    enabled: true,
    categories: ["source_control", "mcp"],
    tags: ["Source control", "MCP"],
  };
}
