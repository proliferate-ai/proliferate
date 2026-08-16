import { describe, expect, it } from "vitest";
import * as capabilities from "#product/config/capabilities";

// User-facing docs links must land on the published docs site. GitHub blob
// paths break silently when repo files move and drop the user into source
// code instead of documentation (PRO-135).
describe("product docs links", () => {
  const docsUrlEntries = Object.entries(capabilities).filter(([name]) =>
    name.endsWith("DOCS_URL"),
  );

  it("covers every docs link this module exports", () => {
    expect(docsUrlEntries.map(([name]) => name).sort()).toEqual([
      "ANYHARNESS_UPDATE_DOCS_URL",
      "CLOUD_SETUP_DOCS_URL",
      "COMMAND_ENVIRONMENT_DOCS_URL",
      "PROLIFERATE_DOCS_URL",
    ]);
  });

  it("points every docs link at the published docs site, never at repository paths", () => {
    for (const [name, url] of docsUrlEntries) {
      expect(url, name).toMatch(/^https:\/\/proliferate\.com\/docs(\/|$)/);
    }
  });

  it("maps each surface to its published page", () => {
    // Shared by the Cloud settings panes, whose operator problems span the
    // whole self-hosting section (deploy, authentication, add-ons).
    expect(capabilities.CLOUD_SETUP_DOCS_URL).toBe(
      "https://proliferate.com/docs/deployment",
    );
    // RunCommandHelp under Settings → Repo → Actions; the page documents the
    // setup script, the run command, and the environment both execute in.
    expect(capabilities.COMMAND_ENVIRONMENT_DOCS_URL).toBe(
      "https://proliferate.com/docs/product/workspaces/setup-action-scripts",
    );
    // Deliberately the docs root; see the constant's comment.
    expect(capabilities.ANYHARNESS_UPDATE_DOCS_URL).toBe(
      "https://proliferate.com/docs",
    );
  });
});
