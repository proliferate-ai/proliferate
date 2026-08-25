import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionListRowV2 } from "@proliferate/cloud-sdk";
import {
  formatWorkflowUpdatedAt,
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
