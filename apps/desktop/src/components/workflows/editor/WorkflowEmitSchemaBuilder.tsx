import { useState } from "react";
import { emitSchemaIssues } from "@proliferate/product-domain/workflows/strict-rules";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { Textarea } from "@proliferate/ui/primitives/Textarea";
import { X } from "@proliferate/ui/icons";
import {
  emitSchemaToModel,
  fieldsToEmitSchema,
  newEmitField,
  type EmitField,
  type EmitFieldType,
} from "@/lib/domain/workflows/emit-schema-model";
import { FieldLabel } from "./WorkflowStepFields";
import { WorkflowSelect } from "./WorkflowSelect";

const FIELD_TYPE_OPTIONS: { value: EmitFieldType; label: string }[] = [
  { value: "string", label: "text" },
  { value: "number", label: "number" },
  { value: "integer", label: "integer" },
  { value: "boolean", label: "boolean" },
  { value: "object", label: "object" },
  { value: "array", label: "array" },
];

const ITEM_TYPE_OPTIONS = [
  { value: "string", label: "text" },
  { value: "number", label: "number" },
  { value: "integer", label: "integer" },
  { value: "boolean", label: "boolean" },
  { value: "object", label: "object" },
];

export interface WorkflowEmitSchemaBuilderProps {
  schema: Record<string, unknown> | undefined;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}

/** One editable field row (recurses for object / array-of-object). */
function FieldRows({
  fields,
  onChange,
}: {
  fields: EmitField[];
  onChange: (next: EmitField[]) => void;
}) {
  const setAt = (index: number, next: EmitField) =>
    onChange(fields.map((field, i) => (i === index ? next : field)));
  const removeAt = (index: number) => onChange(fields.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-2">
      {fields.map((field, index) => (
        <div key={index} className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2">
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1 font-mono"
              aria-label="Property name"
              value={field.name}
              placeholder="field_name"
              onChange={(event) => setAt(index, { ...field, name: event.target.value })}
            />
            <WorkflowSelect
              ariaLabel="Property type"
              value={field.type}
              className="w-28"
              options={FIELD_TYPE_OPTIONS}
              onChange={(type) => setAt(index, { ...field, type: type as EmitFieldType })}
            />
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                aria-label={`${field.name || "field"} required`}
                checked={field.required}
                onChange={(required) => setAt(index, { ...field, required })}
              />
              required
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove property" onClick={() => removeAt(index)}>
              <X className="size-4" />
            </Button>
          </div>
          {field.type === "object" ? (
            <div className="ml-3 border-l border-border/60 pl-3">
              <FieldRows
                fields={field.properties ?? []}
                onChange={(properties) => setAt(index, { ...field, properties })}
              />
              <Button
                variant="unstyled"
                size="unstyled"
                className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setAt(index, { ...field, properties: [...(field.properties ?? []), newEmitField()] })}
              >
                Add nested field
              </Button>
            </div>
          ) : field.type === "array" ? (
            <div className="ml-3 flex flex-col gap-1.5 border-l border-border/60 pl-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Items</span>
                <WorkflowSelect
                  ariaLabel="Array item type"
                  value={field.itemType ?? "string"}
                  className="w-28"
                  options={ITEM_TYPE_OPTIONS}
                  onChange={(itemType) =>
                    setAt(index, { ...field, itemType: itemType as EmitField["itemType"] })
                  }
                />
              </div>
              {field.itemType === "object" ? (
                <div>
                  <FieldRows
                    fields={field.itemProperties ?? []}
                    onChange={(itemProperties) => setAt(index, { ...field, itemProperties })}
                  />
                  <Button
                    variant="unstyled"
                    size="unstyled"
                    className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setAt(index, { ...field, itemProperties: [...(field.itemProperties ?? []), newEmitField()] })
                    }
                  >
                    Add item field
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Structured + raw-JSON authoring for an `agent.emit` output schema (feature
 * spec §6.2, WS9b item 1). The "Fields" tab edits a property/type/required tree
 * within the v1 profile; the "JSON" tab is the escape hatch for richer profile
 * schemas (enum/const/bounds). Both validate live through WS9a's
 * `emitSchemaIssues`; a schema outside the structured subset opens on JSON.
 */
export function WorkflowEmitSchemaBuilder({ schema, onChange }: WorkflowEmitSchemaBuilderProps) {
  const initial = emitSchemaToModel(schema);
  const [mode, setMode] = useState<"fields" | "json">(initial.beyondStructured ? "json" : "fields");
  const [fields, setFields] = useState<EmitField[]>(initial.fields);
  const [rawText, setRawText] = useState<string>(schema ? JSON.stringify(schema, null, 2) : "");
  const [rawError, setRawError] = useState<string | null>(null);

  const commitFields = (next: EmitField[]) => {
    setFields(next);
    onChange(fieldsToEmitSchema(next));
  };

  const commitRaw = (text: string) => {
    setRawText(text);
    if (text.trim() === "") {
      setRawError(null);
      onChange(undefined);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setRawError("Not valid JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setRawError("Schema must be a JSON object.");
      return;
    }
    const record = parsed as Record<string, unknown>;
    const issues = emitSchemaIssues(record, 0);
    if (issues.length > 0) {
      setRawError(issues[0]!.message);
      return;
    }
    setRawError(null);
    onChange(record);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Output schema</FieldLabel>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {(["fields", "json"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                mode === value ? "bg-surface-elevated-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {value === "fields" ? "Fields" : "JSON"}
            </Button>
          ))}
        </div>
      </div>

      {mode === "fields" ? (
        initial.beyondStructured ? (
          <p className="text-xs text-warning">
            This schema uses features the field editor can&apos;t show (enum, bounds, …). Edit it on the
            JSON tab.
          </p>
        ) : (
          <>
            <FieldRows fields={fields} onChange={commitFields} />
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className="self-start text-xs text-muted-foreground hover:text-foreground"
              onClick={() => commitFields([...fields, newEmitField()])}
            >
              Add field
            </Button>
            <p className="text-xs text-faint">
              The agent must return a JSON object matching these fields. Later steps read them as{" "}
              <span className="font-mono">{`{{name.field}}`}</span>.
            </p>
          </>
        )
      ) : (
        <>
          <Textarea
            variant="code"
            aria-label="Output schema JSON"
            rows={8}
            value={rawText}
            placeholder={'{\n  "type": "object",\n  "properties": {}\n}'}
            onChange={(event) => commitRaw(event.target.value)}
          />
          {rawError ? <p className="text-xs text-destructive">{rawError}</p> : null}
        </>
      )}
    </div>
  );
}
