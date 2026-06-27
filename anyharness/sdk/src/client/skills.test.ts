import { describe, expect, it } from "vitest";

import type {
  DeleteSkillResponse,
  InstalledSkill,
  InstalledSkillsResponse,
  MarketplaceSkillSearchResponse,
  WorkspaceSkill,
  WorkspaceSkillsResponse,
} from "../types/skills.js";
import type { AnyHarnessTransport } from "./core.js";
import { SkillsClient } from "./skills.js";

const installedSkill: InstalledSkill = {
  skillId: "owner/repo/test-skill",
  sourceKind: "skills_sh",
  source: "skills.sh",
  slug: "test-skill",
  displayName: "Test Skill",
  description: "Tests skill APIs.",
  installUrl: null,
  sourceUrl: null,
  hash: null,
  installCount: 12,
  auditStatus: "pass",
  audits: [],
  files: [{ path: "SKILL.md", byteSize: 12 }],
  installedAt: "2026-06-27T00:00:00Z",
  updatedAt: "2026-06-27T00:00:00Z",
};

describe("SkillsClient", () => {
  it("uses skills endpoints for list, search, install, and delete", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const transport = {
      get: async (path: string) => {
        calls.push({ method: "GET", path });
        if (path.startsWith("/v1/skills/marketplace/search")) {
          return { query: "code review", skills: [] } satisfies MarketplaceSkillSearchResponse;
        }
        return { skills: [installedSkill] } satisfies InstalledSkillsResponse;
      },
      post: async (path: string, body: unknown) => {
        calls.push({ method: "POST", path, body });
        return installedSkill;
      },
      deleteJson: async (path: string) => {
        calls.push({ method: "DELETE", path });
        return { deleted: true } satisfies DeleteSkillResponse;
      },
    } as unknown as AnyHarnessTransport;
    const client = new SkillsClient(transport);

    await client.list();
    await client.searchMarketplace("code review", { limit: 5 });
    await client.install({
      skillId: "owner/repo/test-skill",
      enableForWorkspaceId: "workspace/1",
      allowMissingAudit: false,
      allowWarningAudit: false,
    });
    await client.delete("owner/repo/test-skill");

    expect(calls).toEqual([
      { method: "GET", path: "/v1/skills" },
      {
        method: "GET",
        path: "/v1/skills/marketplace/search?q=code+review&limit=5",
      },
      {
        method: "POST",
        path: "/v1/skills/install",
        body: {
          skillId: "owner/repo/test-skill",
          enableForWorkspaceId: "workspace/1",
          allowMissingAudit: false,
          allowWarningAudit: false,
        },
      },
      { method: "DELETE", path: "/v1/skills/owner%2Frepo%2Ftest-skill" },
    ]);
  });

  it("encodes workspace and skill ids for workspace enablement", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const workspaceSkill: WorkspaceSkill = {
      skill: installedSkill,
      enabled: true,
    };
    const transport = {
      get: async (path: string) => {
        calls.push({ method: "GET", path });
        return { skills: [workspaceSkill] } satisfies WorkspaceSkillsResponse;
      },
      patch: async (path: string, body: unknown) => {
        calls.push({ method: "PATCH", path, body });
        return workspaceSkill;
      },
    } as unknown as AnyHarnessTransport;
    const client = new SkillsClient(transport);

    await client.listWorkspace("workspace/1");
    await client.updateWorkspaceSkill(
      "workspace/1",
      "owner/repo/test-skill",
      { enabled: true },
    );

    expect(calls).toEqual([
      { method: "GET", path: "/v1/workspaces/workspace%2F1/skills" },
      {
        method: "PATCH",
        path: "/v1/workspaces/workspace%2F1/skills/owner%2Frepo%2Ftest-skill",
        body: { enabled: true },
      },
    ]);
  });
});
