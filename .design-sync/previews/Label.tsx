import { Input, Label } from "@proliferate/ui";

export const WithField = () => (
  <div className="flex w-64 flex-col gap-1.5">
    <Label htmlFor="branch">Base branch</Label>
    <Input id="branch" defaultValue="main" />
  </div>
);

export const Standalone = () => <Label>Repository access</Label>;
