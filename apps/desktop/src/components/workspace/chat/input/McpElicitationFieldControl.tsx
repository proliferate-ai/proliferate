import type { McpElicitationField } from "@anyharness/sdk";
import type { ReactNode } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";

export type McpDraftValue = string | boolean | string[];

interface McpElicitationFieldControlProps {
  field: McpElicitationField;
  value: McpDraftValue | undefined;
  onChange: (value: McpDraftValue) => void;
}

export function McpElicitationFieldControl({
  field,
  value,
  onChange,
}: McpElicitationFieldControlProps) {
  const description = field.description ? (
    <div className="mt-1 text-xs text-muted-foreground">{field.description}</div>
  ) : null;
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (field.fieldType === "boolean") {
    return (
      <div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={Boolean(value)}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          <Label className="mb-0 text-sm text-foreground">{label}</Label>
        </div>
        {description}
      </div>
    );
  }

  if (field.fieldType === "single_select") {
    return (
      <FieldFrame label={label} description={description}>
        <Select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Choose an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option.optionId} value={option.optionId}>
              {option.label}
            </option>
          ))}
        </Select>
      </FieldFrame>
    );
  }

  if (field.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <FieldFrame label={label} description={description}>
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((option) => (
            <Button
              key={option.optionId}
              type="button"
              variant={selected.includes(option.optionId) ? "primary" : "secondary"}
              size="sm"
              className="h-auto justify-start rounded-xl px-3 py-2 text-left"
              onClick={() => {
                onChange(selected.includes(option.optionId)
                  ? selected.filter((entry) => entry !== option.optionId)
                  : [...selected, option.optionId]);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </FieldFrame>
    );
  }

  return (
    <FieldFrame label={label} description={description}>
      <Input
        type={field.fieldType === "number" ? "number" : "text"}
        value={typeof value === "string" ? value : ""}
        min={field.fieldType === "number" ? field.minimum ?? undefined : undefined}
        max={field.fieldType === "number" ? field.maximum ?? undefined : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        data-telemetry-mask="true"
      />
    </FieldFrame>
  );
}

function FieldFrame({
  label,
  description,
  children,
}: {
  label: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {description}
    </div>
  );
}
