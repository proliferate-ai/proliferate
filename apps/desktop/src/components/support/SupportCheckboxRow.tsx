import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Label } from "@proliferate/ui/primitives/Label";

interface SupportCheckboxRowProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  /** Helper line revealed under the row while the box is checked. */
  helper?: string;
}

/**
 * A support-modal checkbox row: a plain, low-profile clickable label wrapping
 * a Radix checkbox, with an optional helper line that appears only while
 * checked. Kept unbordered so several can stack without feeling heavy.
 */
export function SupportCheckboxRow({
  checked,
  onCheckedChange,
  label,
  helper,
}: SupportCheckboxRowProps) {
  return (
    <div>
      <Label className="mb-0 flex cursor-pointer items-center gap-2.5 py-1 text-ui-sm text-foreground">
        <Checkbox
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        <span className="text-ui-sm">{label}</span>
      </Label>
      {helper && checked ? (
        <p className="mt-0.5 pl-6 text-ui-sm text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  );
}
