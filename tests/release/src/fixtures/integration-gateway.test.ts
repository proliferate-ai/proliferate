import assert from "node:assert/strict";
import { test } from "node:test";

import { pickSearchTool, resolveRuntimeHome } from "./integration-gateway.js";

test("pickSearchTool prefers a web_search-shaped tool and fills a query arg", () => {
  const picked = pickSearchTool(
    [
      { name: "get_contents", inputSchema: { properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "web_search_exa", inputSchema: { properties: { query: { type: "string" } }, required: ["query"] } },
    ],
    "Proliferate AI",
  );
  assert.ok(picked);
  assert.equal(picked.tool, "web_search_exa");
  assert.equal(picked.arguments.query, "Proliferate AI");
});

test("pickSearchTool falls back to a plain 'search' name", () => {
  const picked = pickSearchTool(
    [{ name: "search", inputSchema: { properties: { q: { type: "string" } }, required: ["q"] } }],
    "hello",
  );
  assert.ok(picked);
  assert.equal(picked.tool, "search");
  assert.equal(picked.arguments.q, "hello");
});

test("pickSearchTool fills required non-query fields with typed defaults", () => {
  const picked = pickSearchTool(
    [
      {
        name: "web_search",
        inputSchema: {
          properties: { query: { type: "string" }, numResults: { type: "integer" }, live: { type: "boolean" } },
          required: ["query", "numResults"],
        },
      },
    ],
    "q",
  );
  assert.ok(picked);
  assert.equal(picked.arguments.query, "q");
  assert.equal(picked.arguments.numResults, 1);
});

test("pickSearchTool defaults to a query arg when the tool has no schema", () => {
  const picked = pickSearchTool([{ name: "mystery" }], "term");
  assert.ok(picked);
  assert.equal(picked.tool, "mystery");
  assert.equal(picked.arguments.query, "term");
});

test("pickSearchTool returns undefined for an empty tool list", () => {
  assert.equal(pickSearchTool([], "x"), undefined);
});

test("resolveRuntimeHome prefers ANYHARNESS_RUNTIME_HOME", () => {
  assert.equal(resolveRuntimeHome({ ANYHARNESS_RUNTIME_HOME: "/tmp/rt" }), "/tmp/rt");
});

test("resolveRuntimeHome falls back to the desktop default under HOME", () => {
  const resolved = resolveRuntimeHome({});
  assert.ok(resolved && resolved.endsWith("/.proliferate/anyharness"));
});
