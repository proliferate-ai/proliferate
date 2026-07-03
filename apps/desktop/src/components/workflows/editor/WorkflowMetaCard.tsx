import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export interface WorkflowMetaCardProps {
  name: string;
  description: string;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
}

export function WorkflowMetaCard({ name, description, onNameChange, onDescriptionChange }: WorkflowMetaCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-background p-4">
      <div className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <Input value={name} placeholder="Untitled workflow" onChange={(event) => onNameChange(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Description</Label>
        <Textarea
          value={description}
          rows={2}
          placeholder="What does this workflow do?"
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </div>
    </div>
  );
}
