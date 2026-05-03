import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { CreateCustomMcpDefinitionRequest } from "@/lib/integrations/cloud/client";

export function CustomMcpDefinitionForm({
  disabled = false,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (payload: CreateCustomMcpDefinitionRequest) => void;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [authKind, setAuthKind] = useState<"secret" | "none">("none");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");

  function submit() {
    const payload: CreateCustomMcpDefinitionRequest = {
      name,
      description,
      transport,
      authKind,
      availability: transport === "stdio" ? "local_only" : "universal",
      enabled: true,
      secretFields: authKind === "secret"
        ? [{
            id: "api_key",
            label: "API key",
            placeholder: "Paste API key",
            helperText: "Stored encrypted with the connector connection.",
            getTokenInstructions: "Create or copy an API key from the MCP provider.",
          }]
        : [],
      ...(transport === "http"
        ? { http: { url, headers: [], query: [] } }
        : { stdio: { command, args: [], env: [] } }),
    };
    onSubmit(payload);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="custom-mcp-name">Name</Label>
        <Input
          id="custom-mcp-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="custom-mcp-transport">Transport</Label>
          <Select
            id="custom-mcp-transport"
            value={transport}
            onChange={(event) => setTransport(event.target.value as "http" | "stdio")}
            disabled={disabled}
          >
            <option value="http">HTTP</option>
            <option value="stdio">stdio</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="custom-mcp-auth">Auth</Label>
          <Select
            id="custom-mcp-auth"
            value={authKind}
            onChange={(event) => setAuthKind(event.target.value as "secret" | "none")}
            disabled={disabled}
          >
            <option value="none">No credentials</option>
            <option value="secret">API key</option>
          </Select>
        </div>
      </div>
      {transport === "http" ? (
        <div className="space-y-2">
          <Label htmlFor="custom-mcp-url">URL</Label>
          <Input
            id="custom-mcp-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={disabled}
            type="url"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="custom-mcp-command">Command</Label>
          <Input
            id="custom-mcp-command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            disabled={disabled}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="custom-mcp-description">Description</Label>
        <Textarea
          id="custom-mcp-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={disabled}
        />
      </div>
      <Button type="button" onClick={submit} disabled={disabled || !name.trim()}>
        Save
      </Button>
    </div>
  );
}
