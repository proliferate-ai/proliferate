import type { components } from "./generated/openapi.js";

type ModelSelection = components["schemas"]["WorkflowRunModelSelection"];

const exactSelection: ModelSelection = { kind: "exact", modelId: "sonnet" };
// @ts-expect-error exact selection requires generated camelCase modelId.
const missingExactModel: ModelSelection = { kind: "exact" };
// @ts-expect-error generated contract must never accept snake_case model_id.
const snakeCaseExactModel: ModelSelection = { kind: "exact", model_id: "sonnet" };

void exactSelection;
void missingExactModel;
void snakeCaseExactModel;
