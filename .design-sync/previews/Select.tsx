import { Select } from "@proliferate/ui";

export const Default = () => (
  <div className="w-56">
    <Select defaultValue="cloud" onChange={() => {}}>
      <option value="local">Local runtime</option>
      <option value="cloud">Cloud sandbox</option>
      <option value="ssh">SSH target</option>
    </Select>
  </div>
);
