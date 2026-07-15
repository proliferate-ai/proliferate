import { Checkbox } from "@proliferate/ui/primitives/Checkbox";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";

interface SupportCreditFieldProps {
  label: string;
  creditConsent: boolean;
  setCreditConsent: (checked: boolean) => void;
  creditName: string;
  setCreditName: (value: string) => void;
}

/**
 * "Credit me" consent checkbox with an animated name input that reveals while
 * checked. Shared by the bug and prompt support modals so both surfaces get the
 * identical interaction.
 */
export function SupportCreditField({
  label,
  creditConsent,
  setCreditConsent,
  creditName,
  setCreditName,
}: SupportCreditFieldProps) {
  return (
    <div>
      <Label className="mb-0 flex cursor-pointer items-center gap-2.5 py-1 text-ui-sm text-foreground">
        <Checkbox
          checked={creditConsent}
          onCheckedChange={(checked) => setCreditConsent(checked === true)}
        />
        <span className="text-ui-sm">{label}</span>
      </Label>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: creditConsent ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden pl-6">
          <Input
            value={creditName}
            onChange={(event) => setCreditName(event.target.value)}
            placeholder="Your name or @handle"
            aria-label="Name to credit"
            className="mb-1 mt-0.5"
          />
        </div>
      </div>
    </div>
  );
}
