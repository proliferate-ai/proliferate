import { describe, expect, it } from "vitest";
import {
  functionInvocationChatScopeLabel,
  functionInvocationMethodLabel,
  functionInvocationSubmitError,
  parseFunctionInvocationArgsSchema,
  validateFunctionInvocationForm,
  type FunctionInvocationFormInput,
} from "@/lib/domain/settings/function-invocations-presentation";

const valid: FunctionInvocationFormInput = {
  name: "lookup_order",
  displayName: "Lookup order",
  description: "Looks up an order by id.",
  endpointUrl: "https://api.example.com/orders/lookup",
  method: "post",
  argsSchemaText: JSON.stringify({ type: "object", properties: { id: { type: "string" } } }),
};

describe("validateFunctionInvocationForm", () => {
  it("accepts a valid form", () => {
    expect(validateFunctionInvocationForm(valid)).toBeNull();
  });

  it("rejects names that break the server pattern", () => {
    for (const name of ["", "Bad-Name", "1starts-with-digit", "has space", "a".repeat(65)]) {
      const errors = validateFunctionInvocationForm({ ...valid, name });
      expect(errors?.name).toBeDefined();
    }
  });

  it("accepts names at the pattern boundaries", () => {
    expect(validateFunctionInvocationForm({ ...valid, name: "a" })).toBeNull();
    expect(validateFunctionInvocationForm({ ...valid, name: "a".repeat(64) })).toBeNull();
    expect(validateFunctionInvocationForm({ ...valid, name: "a0_b" })).toBeNull();
  });

  it("rejects non-http(s) or malformed endpoint URLs", () => {
    for (const endpointUrl of ["", "not a url", "ftp://example.com", "https://"]) {
      expect(validateFunctionInvocationForm({ ...valid, endpointUrl })?.endpointUrl).toBeDefined();
    }
    expect(
      validateFunctionInvocationForm({ ...valid, endpointUrl: "http://localhost:8080/hook" }),
    ).toBeNull();
  });

  it("rejects an unsupported method", () => {
    expect(validateFunctionInvocationForm({ ...valid, method: "head" })?.method).toBeDefined();
    expect(validateFunctionInvocationForm({ ...valid, method: "POST" })).toBeNull();
  });

  it("treats an empty args schema as valid (no schema)", () => {
    expect(validateFunctionInvocationForm({ ...valid, argsSchemaText: "" })).toBeNull();
    expect(validateFunctionInvocationForm({ ...valid, argsSchemaText: "   " })).toBeNull();
  });

  it("rejects malformed JSON or a non-object args schema", () => {
    for (const argsSchemaText of ["{not json", "[1, 2, 3]", "\"a string\"", "42"]) {
      expect(
        validateFunctionInvocationForm({ ...valid, argsSchemaText })?.argsSchemaText,
      ).toBeDefined();
    }
  });

  it("reports every invalid field at once", () => {
    const errors = validateFunctionInvocationForm({
      name: "",
      displayName: "",
      description: "",
      endpointUrl: "nope",
      method: "head",
      argsSchemaText: "{not json",
    });
    expect(errors).toEqual({
      name: expect.any(String),
      endpointUrl: expect.any(String),
      method: expect.any(String),
      argsSchemaText: expect.any(String),
    });
  });
});

describe("parseFunctionInvocationArgsSchema round-trip", () => {
  it("round-trips a valid schema through validate -> parse", () => {
    expect(validateFunctionInvocationForm(valid)).toBeNull();
    expect(parseFunctionInvocationArgsSchema(valid.argsSchemaText)).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  it("treats empty text as an empty schema", () => {
    expect(parseFunctionInvocationArgsSchema("")).toEqual({});
    expect(parseFunctionInvocationArgsSchema("   ")).toEqual({});
  });

  it("falls back to an empty schema for invalid text (never throws)", () => {
    expect(parseFunctionInvocationArgsSchema("{not json")).toEqual({});
    expect(parseFunctionInvocationArgsSchema("[1, 2]")).toEqual({});
  });
});

describe("functionInvocationMethodLabel", () => {
  it("uppercases the method", () => {
    expect(functionInvocationMethodLabel("post")).toBe("POST");
    expect(functionInvocationMethodLabel("get")).toBe("GET");
  });
});

describe("functionInvocationChatScopeLabel", () => {
  it("labels the §2 default-access toggle state", () => {
    expect(functionInvocationChatScopeLabel(true)).toBe("Enabled for chat");
    expect(functionInvocationChatScopeLabel(false)).toBe("Workflow only");
  });
});

describe("functionInvocationSubmitError", () => {
  it("surfaces the API validation message inline", () => {
    const message = "You already have a function invocation named 'lookup_order'.";
    expect(functionInvocationSubmitError(message)).toBe(message);
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(functionInvocationSubmitError(null)).toBe("The function could not be saved. Try again.");
    expect(functionInvocationSubmitError("")).toBe("The function could not be saved. Try again.");
  });
});
