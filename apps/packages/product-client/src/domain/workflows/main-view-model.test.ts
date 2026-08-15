import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionListRowV2 } from "@proliferate/cloud-sdk";
import {
  formatWorkflowUpdatedAt,
  selectWorkflowLegacyDefinitionRows,
  selectWorkflowV2DefinitionRows,
} from "./main-view-model";

function row(overrides: Partial<WorkflowDefinitionListRowV2>): WorkflowDefinitionListRowV2 {
  return {
    id: "wf-1",
    title: "Issue triage",
    description: "Triages new issues.",
    revision: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-08-14T12:00:00Z",
    ...overrides,
  };
}

describe("selectWorkflowV2DefinitionRows", () => {
  it("keeps only rows whose schemaVersion is 2", () => {
    const rows = [
      row({ id: "wf-v2", schemaVersion: 2 }),
      row({ id: "wf-v1", schemaVersion: 1 }),
      row({ id: "wf-untyped", schemaVersion: undefined }),
    ];

    const items = selectWorkflowV2DefinitionRows(rows);

    expect(items.map((item) => item.id)).toEqual(["wf-v2"]);
  });

  it("projects title, description, updated-at and revision", () => {
    const items = selectWorkflowV2DefinitionRows([
      row({
        id: "wf-1",
        title: "Issue triage",
        description: "Triages new issues.",
        revision: 3,
        updatedAt: "2026-08-14T12:00:00Z",
        schemaVersion: 2,
      }),
    ]);

    expect(items).toEqual([{
      id: "wf-1",
      title: "Issue triage",
      description: "Triages new issues.",
      updatedAt: "2026-08-14T12:00:00Z",
      revision: 3,
    }]);
  });

  it("defaults a missing description to an empty string", () => {
    const items = selectWorkflowV2DefinitionRows([
      row({ description: undefined, schemaVersion: 2 }),
    ]);

    expect(items[0].description).toBe("");
  });
});

describe("selectWorkflowLegacyDefinitionRows", () => {
  it("keeps every row the v2 selector drops, so no saved definition is lost", () => {
    const rows = [
      row({ id: "wf-v2", schemaVersion: 2 }),
      row({ id: "wf-v1", schemaVersion: 1 }),
      row({ id: "wf-untyped", schemaVersion: undefined }),
      row({ id: "wf-future", schemaVersion: 3 }),
    ];

    const v2Ids = selectWorkflowV2DefinitionRows(rows).map((item) => item.id);
    const legacyIds = selectWorkflowLegacyDefinitionRows(rows).map((item) => item.id);

    expect(legacyIds).toEqual(["wf-v1", "wf-untyped", "wf-future"]);
    expect([...v2Ids, ...legacyIds].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("projects the same fields a delete needs, revision included", () => {
    const items = selectWorkflowLegacyDefinitionRows([
      row({
        id: "wf-v1",
        title: "Nightly triage",
        description: undefined,
        revision: 7,
        updatedAt: "2020-03-05T00:00:00Z",
        schemaVersion: 1,
      }),
    ]);

    expect(items).toEqual([{
      id: "wf-v1",
      title: "Nightly triage",
      description: "",
      updatedAt: "2020-03-05T00:00:00Z",
      revision: 7,
    }]);
  });

  it("returns nothing when every row is gen-2", () => {
    expect(selectWorkflowLegacyDefinitionRows([row({ schemaVersion: 2 })])).toEqual([]);
  });
});

describe("formatWorkflowUpdatedAt", () => {
  it("omits the year for the current year", () => {
    const thisYear = new Date().getFullYear();
    expect(formatWorkflowUpdatedAt(`${thisYear}-03-05T00:00:00Z`)).not.toContain(
      String(thisYear),
    );
  });

  it("includes the year for a past year", () => {
    expect(formatWorkflowUpdatedAt("2020-03-05T00:00:00Z")).toContain("2020");
  });

  it("returns an empty string for an unparsable date", () => {
    expect(formatWorkflowUpdatedAt("not-a-date")).toBe("");
  });
});
