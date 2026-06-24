import type { CSSProperties } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { COMPUTE_COPY } from "@/copy/settings/compute";
import {
  COMPUTE_TARGET_COLOR_OPTIONS,
  COMPUTE_TARGET_ICON_OPTIONS,
  type ComputeTargetColorId,
  type ComputeTargetIconId,
} from "@/lib/domain/compute/target-appearance";
import { ComputeTargetIconGlyph } from "@/components/compute/ComputeTargetSwatch";

export function ComputeTargetAppearanceSection({
  displayName,
  iconId,
  colorId,
  onDisplayNameChange,
  onIconChange,
  onColorChange,
}: {
  displayName: string;
  iconId: ComputeTargetIconId;
  colorId: ComputeTargetColorId;
  onDisplayNameChange: (value: string) => void;
  onIconChange: (value: ComputeTargetIconId) => void;
  onColorChange: (value: ComputeTargetColorId) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">Appearance</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {COMPUTE_COPY.appearanceHelp}
        </p>
      </div>
      <div>
        <Label htmlFor="compute-target-detail-display-name">Name</Label>
        <Input
          id="compute-target-detail-display-name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Icon</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {COMPUTE_TARGET_ICON_OPTIONS.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label={option.label}
              aria-pressed={iconId === option.id}
              title={option.label}
              className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-foreground ${
                iconId === option.id
                  ? "border-foreground text-foreground"
                  : "border-transparent bg-surface-control text-muted-foreground"
              }`}
              onClick={() => onIconChange(option.id)}
            >
              <ComputeTargetIconGlyph iconId={option.id} />
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {COMPUTE_TARGET_COLOR_OPTIONS.map((option) => {
            const style = {
              "--compute-target-color": option.value,
            } as CSSProperties;
            return (
              <Button
                key={option.id}
                type="button"
                variant="unstyled"
                size="unstyled"
                aria-label={option.label}
                aria-pressed={colorId === option.id}
                title={option.label}
                className={`relative size-[26px] rounded-md border bg-[var(--compute-target-color)] transition-transform hover:scale-105 ${
                  colorId === option.id
                    ? "ring-1 ring-foreground ring-offset-2 ring-offset-background"
                    : "border-border"
                }`}
                style={style}
                onClick={() => onColorChange(option.id)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
