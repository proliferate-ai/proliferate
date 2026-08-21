import { describe, expect, it } from "vitest";

import { scrubTelemetryData } from "./scrub";
import {
  BOUNDED_ROUTE_TEMPLATES,
  MAX_REDACTION_VISITS,
  REDACTED_URL,
  UNKNOWN_BOUNDED_ROUTE,
  boundRoutePathname,
  boundRouteUrl,
  redactRouteIdentifiersInAttribute,
  redactRouteIdentifiersInCapture,
  redactRouteIdentifiersInText,
} from "./route-id-redaction";

// Distinctive so an absence assertion cannot pass by accident on a substring
// of some other value in the payload.
const WORKFLOW_ID = "wf-8e1c4a92-route-id-leak-probe";
const RUN_ID = "run-5b7d0f31-route-id-leak-probe";
const WORKSPACE_ID = "ws-c30a6e75-route-id-leak-probe";
const ORG_SLUG = "acme-holdings-route-id-leak-probe";

const ORIGIN = "https://app.proliferate.com";
const LEAKING_URL = `${ORIGIN}/workflows/${WORKFLOW_ID}/runs/${RUN_ID}?invite=secret#panel`;
const BOUNDED_URL = `${ORIGIN}/workflows/:workflowId/runs/:runId`;

const ALL_IDENTIFIERS = [WORKFLOW_ID, RUN_ID, WORKSPACE_ID, ORG_SLUG];

/**
 * A serialized rrweb DOM deep enough that the shared scrubber's depth cap
 * (`MAX_SCRUB_DEPTH = 10` in `./scrub`) would replace it with a truncation
 * marker. The leaking `href` sits at the bottom.
 */
function buildDeepSerializedDom() {
  let node: Record<string, unknown> = {
    type: 2,
    tagName: "a",
    attributes: {
      class: "sidebar-link",
      href: `/workspaces/${WORKSPACE_ID}`,
      "data-testid": "workspace-link",
      title: "Open /Users/pablo/proliferate/apps/desktop",
    },
    childNodes: [{ type: 3, id: 991, textContent: "***** ****" }],
    id: 990,
  };

  for (let depth = 0; depth < 14; depth += 1) {
    node = {
      type: 2,
      tagName: "div",
      attributes: { class: `layer-${depth}` },
      childNodes: [node],
      id: 900 - depth,
    };
  }

  return {
    type: 0,
    childNodes: [
      { type: 1, name: "html", publicId: "", systemId: "", id: 2 },
      {
        type: 2,
        tagName: "html",
        attributes: {},
        id: 3,
        childNodes: [
          {
            type: 2,
            tagName: "head",
            attributes: {},
            id: 4,
            childNodes: [
              {
                type: 2,
                tagName: "link",
                attributes: {
                  rel: "canonical",
                  href: `${ORIGIN}/workflows/${WORKFLOW_ID}`,
                },
                childNodes: [],
                id: 5,
              },
            ],
          },
          {
            type: 2,
            tagName: "body",
            attributes: {},
            id: 6,
            childNodes: [node],
          },
        ],
      },
    ],
    id: 1,
  };
}

/**
 * The shape posthog-js hands to `before_send` for a replay chunk: the rrweb
 * stream under `properties.$snapshot_data`, plus the URL properties that
 * `calculateEventProperties` attaches to every event.
 */
function buildSnapshotCapture() {
  return {
    event: "$snapshot",
    properties: {
      $session_id: "0198f0c2-1111-7000-8000-aaaaaaaaaaaa",
      $window_id: "0198f0c2-2222-7000-8000-bbbbbbbbbbbb",
      $current_url: LEAKING_URL,
      $pathname: `/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`,
      $host: "app.proliferate.com",
      $referrer: `${ORIGIN}/workspaces/${WORKSPACE_ID}`,
      $session_entry_url: `${ORIGIN}/join/${ORG_SLUG}`,
      $prev_pageview_pathname: `/workspaces/${WORKSPACE_ID}`,
      $set_once: {
        $initial_current_url: `${ORIGIN}/login/${ORG_SLUG}`,
        $initial_pathname: `/login/${ORG_SLUG}`,
      },
      $snapshot_bytes: 4096,
      $snapshot_data: [
        {
          type: 4,
          timestamp: 1_755_000_000_000,
          data: { href: LEAKING_URL, width: 1440, height: 900 },
        },
        {
          type: 2,
          timestamp: 1_755_000_000_010,
          data: { node: buildDeepSerializedDom(), initialOffset: { top: 0, left: 0 } },
        },
        {
          type: 3,
          timestamp: 1_755_000_000_020,
          data: {
            source: 0,
            attributes: [
              { id: 990, attributes: { href: `/workflows/${WORKFLOW_ID}` } },
            ],
            texts: [],
            removes: [],
            adds: [],
          },
        },
        {
          type: 5,
          timestamp: 1_755_000_000_030,
          data: {
            tag: "$pageview",
            payload: { href: `${ORIGIN}/workspaces/${WORKSPACE_ID}` },
          },
        },
        {
          type: 5,
          timestamp: 1_755_000_000_040,
          data: {
            tag: "performance",
            payload: {
              name: `${ORIGIN}/api/v1/workflows/${WORKFLOW_ID}`,
              initiatorType: "fetch",
            },
          },
        },
      ],
    },
  };
}

describe("the leak this module exists to close", () => {
  it("shows the shared scrubber leaves every route identifier in the payload", () => {
    // Executable record of the 2026-08-18 finding. `preservePostHogInternalKeys`
    // exempts `$`-prefixed keys from key redaction, and `scrubTelemetryUrl`
    // keeps the path, so the shared scrubber is a no-op for this class.
    const scrubbed = scrubTelemetryData(buildSnapshotCapture(), {
      preservePostHogInternalKeys: true,
    });
    const serialized = JSON.stringify(scrubbed);

    for (const identifier of ALL_IDENTIFIERS) {
      expect(serialized).toContain(identifier);
    }
  });

  it("shows the shared scrubber would also shred the rrweb payload", () => {
    const scrubbed = scrubTelemetryData(buildSnapshotCapture(), {
      preservePostHogInternalKeys: true,
    });

    expect(JSON.stringify(scrubbed)).toContain("[truncated]");
  });
});

describe("redactRouteIdentifiersInCapture", () => {
  it("removes every route identifier from a replay capture", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const serialized = JSON.stringify(redacted);

    for (const identifier of ALL_IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
  });

  it("replaces the recorded page URL with a bounded route template", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const properties = redacted?.properties as Record<string, unknown>;

    expect(properties.$current_url).toBe(BOUNDED_URL);
    expect(properties.$pathname).toBe("/workflows/:workflowId/runs/:runId");
    expect(properties.$referrer).toBe(`${ORIGIN}/workspaces/:workspaceId`);
    expect(properties.$session_entry_url).toBe(`${ORIGIN}/join/:orgId`);
    expect(properties.$prev_pageview_pathname).toBe("/workspaces/:workspaceId");
    expect(properties.$set_once).toEqual({
      $initial_current_url: `${ORIGIN}/login/:slug`,
      $initial_pathname: "/login/:slug",
    });
  });

  it("redacts the rrweb Meta event href, which no property deletion reaches", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const stream = (redacted?.properties as Record<string, unknown>)
      .$snapshot_data as Array<Record<string, unknown>>;

    expect((stream[0].data as Record<string, unknown>).href).toBe(BOUNDED_URL);
    // Non-URL Meta fields are untouched, so the replay still knows its viewport.
    expect((stream[0].data as Record<string, unknown>).width).toBe(1440);
  });

  it("redacts href attributes nested below the shared scrubber's depth cap", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain("/workspaces/:workspaceId");
    expect(serialized).toContain(`${ORIGIN}/workflows/:workflowId`);
    expect(serialized).not.toContain("[truncated]");
  });

  it("redacts attribute-mutation and custom rrweb events", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const stream = (redacted?.properties as Record<string, unknown>)
      .$snapshot_data as Array<Record<string, unknown>>;

    const mutation = stream[2].data as { attributes: Array<{ attributes: Record<string, string> }> };
    expect(mutation.attributes[0].attributes.href).toBe("/workflows/:workflowId");

    const pageview = stream[3].data as { payload: Record<string, string> };
    expect(pageview.payload.href).toBe(`${ORIGIN}/workspaces/:workspaceId`);

    const performance = stream[4].data as { payload: Record<string, string> };
    expect(performance.payload.name).toBe(`${ORIGIN}${UNKNOWN_BOUNDED_ROUTE}`);
    expect(performance.payload.initiatorType).toBe("fetch");
  });

  it("preserves the replay structure it redacts", () => {
    const original = buildSnapshotCapture();
    const redacted = redactRouteIdentifiersInCapture(original);
    const stream = (redacted?.properties as Record<string, unknown>)
      .$snapshot_data as unknown[];

    expect(redacted?.event).toBe("$snapshot");
    expect(stream).toHaveLength(original.properties.$snapshot_data.length);
    expect((redacted?.properties as Record<string, unknown>).$session_id)
      .toBe(original.properties.$session_id);
    expect((redacted?.properties as Record<string, unknown>).$host)
      .toBe("app.proliferate.com");
    expect((redacted?.properties as Record<string, unknown>).$snapshot_bytes).toBe(4096);

    // Class names and test ids are rendering fidelity, not identity: they stay.
    expect(JSON.stringify(redacted)).toContain("sidebar-link");
    expect(JSON.stringify(redacted)).toContain("layer-13");
  });

  it("scrubs content-bearing attributes that recorder masking does not cover", () => {
    const redacted = redactRouteIdentifiersInCapture(buildSnapshotCapture());
    const serialized = JSON.stringify(redacted);

    // `title` is not a text node or an input, so `maskTextSelector`/
    // `maskAllInputs` never touch it.
    expect(serialized).not.toContain("/Users/pablo/proliferate");
    expect(serialized).toContain("[redacted-path]");
  });

  it("does not mutate the capture it was handed", () => {
    const original = buildSnapshotCapture();
    redactRouteIdentifiersInCapture(original);

    expect(original.properties.$current_url).toBe(LEAKING_URL);
  });

  it("redacts ordinary product events, not only replay snapshots", () => {
    const redacted = redactRouteIdentifiersInCapture({
      event: "chat_prompt_submitted",
      properties: {
        agent_kind: "claude",
        reuse_session: true,
        $current_url: `${ORIGIN}/workspaces/${WORKSPACE_ID}`,
      },
    });

    const properties = redacted?.properties as Record<string, unknown>;
    expect(properties.$current_url).toBe(`${ORIGIN}/workspaces/:workspaceId`);
    expect(properties.agent_kind).toBe("claude");
    expect(properties.reuse_session).toBe(true);
  });

  it("redacts the top-level $set and $set_once siblings of properties", () => {
    const redacted = redactRouteIdentifiersInCapture({
      event: "$identify",
      properties: { $current_url: `${ORIGIN}/workspaces/${WORKSPACE_ID}` },
      $set: { $current_url: `${ORIGIN}/workflows/${WORKFLOW_ID}` },
      $set_once: { $initial_current_url: `${ORIGIN}/join/${ORG_SLUG}` },
    });

    expect(redacted?.$set).toEqual({ $current_url: `${ORIGIN}/workflows/:workflowId` });
    expect(redacted?.$set_once).toEqual({
      $initial_current_url: `${ORIGIN}/join/:orgId`,
    });
    expect(JSON.stringify(redacted)).not.toContain(ORG_SLUG);
  });

  it("passes through a capture with no properties", () => {
    expect(redactRouteIdentifiersInCapture(null)).toBeNull();
    expect(redactRouteIdentifiersInCapture({ event: "x" })).toEqual({ event: "x" });
  });

  it("drops a capture that exceeds the redaction budget rather than sending it", () => {
    const oversized = {
      event: "$snapshot",
      properties: {
        $snapshot_data: Array.from({ length: MAX_REDACTION_VISITS + 10 }, () => ({
          href: `/workflows/${WORKFLOW_ID}`,
        })),
      },
    };

    expect(redactRouteIdentifiersInCapture(oversized)).toBeNull();
  });
});

describe("boundRoutePathname", () => {
  it("maps every declared template back to itself", () => {
    for (const template of BOUNDED_ROUTE_TEMPLATES) {
      const concrete = template
        .split("/")
        .map((segment) => (segment.startsWith(":") ? "0198f0c2-dead-beef" : segment))
        .join("/");
      expect(boundRoutePathname(concrete)).toBe(template);
    }
  });

  it.each([
    ["/", "/"],
    ["", "/"],
    ["/workflows", "/workflows"],
    ["/workflows/", "/workflows"],
    ["/WorkFlows/abc", "/workflows/:workflowId"],
    ["/workspaces/abc?tab=files#top", "/workspaces/:workspaceId"],
    ["/automations/abc", "/automations/:workflowId"],
  ])("bounds %s to %s", (input, expected) => {
    expect(boundRoutePathname(input)).toBe(expected);
  });

  it.each([
    "/workflows/a/b",
    "/workflows/a/runs",
    "/workflows/a/runs/b/c",
    "/playground/chat",
    "/admin/users/42",
    "/workspaces//",
    "/.env",
    "/Users/pablo/proliferate/secret.txt",
  ])("fails closed on %s", (input) => {
    expect(boundRoutePathname(input)).toBe(UNKNOWN_BOUNDED_ROUTE);
  });
});

describe("boundRouteUrl", () => {
  it.each([
    [LEAKING_URL, BOUNDED_URL],
    [`${ORIGIN}/`, `${ORIGIN}/`],
    [ORIGIN, `${ORIGIN}/`],
    ["tauri://localhost/workflows/abc", "tauri://localhost/workflows/:workflowId"],
    ["http://localhost:1420/workspaces/abc", "http://localhost:1420/workspaces/:workspaceId"],
    [`/workflows/${WORKFLOW_ID}`, "/workflows/:workflowId"],
    ["/does/not/exist", UNKNOWN_BOUNDED_ROUTE],
  ])("bounds %s", (input, expected) => {
    expect(boundRouteUrl(input)).toBe(expected);
  });

  it.each(["", "   ", "not a url", "./relative/path", "mailto:support@proliferate.com"])(
    "returns null for the unboundable value %p",
    (input) => {
      expect(boundRouteUrl(input)).toBeNull();
    },
  );
});

describe("redactRouteIdentifiersInText", () => {
  it("leaves non-URL text alone", () => {
    expect(redactRouteIdentifiersInText("chat_prompt_submitted")).toBe(
      "chat_prompt_submitted",
    );
  });

  it("bounds a URL embedded as a whole value", () => {
    expect(redactRouteIdentifiersInText(LEAKING_URL)).toBe(BOUNDED_URL);
  });
});

describe("redactRouteIdentifiersInAttribute", () => {
  it("bounds a URL-valued attribute", () => {
    expect(redactRouteIdentifiersInAttribute("href", `/workflows/${WORKFLOW_ID}`)).toBe(
      "/workflows/:workflowId",
    );
    expect(redactRouteIdentifiersInAttribute("HREF", LEAKING_URL)).toBe(BOUNDED_URL);
  });

  it("fails closed on a URL-valued attribute it cannot bound", () => {
    expect(
      redactRouteIdentifiersInAttribute("srcset", `a-${WORKFLOW_ID}.png 1x, b.png 2x`),
    ).toBe(REDACTED_URL);
    expect(redactRouteIdentifiersInAttribute("src", `assets/${WORKFLOW_ID}.png`)).toBe(
      REDACTED_URL,
    );
  });

  it("keeps in-page fragments and inline schemes so replay still renders", () => {
    expect(redactRouteIdentifiersInAttribute("href", "#main")).toBe("#main");
    expect(redactRouteIdentifiersInAttribute("src", "data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(redactRouteIdentifiersInAttribute("href", "mailto:support@proliferate.com")).toBe(
      "mailto:support@proliferate.com",
    );
  });

  it("leaves rendering attributes untouched", () => {
    expect(redactRouteIdentifiersInAttribute("class", "flex items-center")).toBe(
      "flex items-center",
    );
    expect(redactRouteIdentifiersInAttribute("id", "chat-composer")).toBe("chat-composer");
  });

  it("still bounds a URL that shows up under a non-URL attribute name", () => {
    expect(redactRouteIdentifiersInAttribute("data-return-to", LEAKING_URL)).toBe(
      BOUNDED_URL,
    );
  });
});
