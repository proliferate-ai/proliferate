import type { components } from "./generated/openapi.js";

type LifecycleResponse = components["schemas"]["SubagentLifecycleResponse"];

const promoted: LifecycleResponse = {
  agent: null as never,
  relationship: null,
};
// @ts-expect-error relationship is always present; Promote uses explicit null.
const omittedRelationship: LifecycleResponse = { agent: null as never };

void promoted;
void omittedRelationship;
