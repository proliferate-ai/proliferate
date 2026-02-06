import { existsSync, readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { exposePort, getServices, startService, stopService } from "./service-manager.js";

const PREVIEW_URL_FILE = "/tmp/.proliferate_preview_url";

const server = new Server(
	{
		name: "sandbox-mcp",
		version: "0.1.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "start_service",
				description:
					"Start a background service (like a dev server). The service will run until stopped. Use this for processes that should keep running, like 'npm run dev' or 'python -m http.server'.",
				inputSchema: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "A short name for the service (e.g., 'frontend', 'backend', 'api')",
						},
						command: {
							type: "string",
							description: "The command to run (e.g., 'npm run dev', 'python -m http.server 3000')",
						},
						cwd: {
							type: "string",
							description:
								"Working directory for the command. Defaults to /workspace if not specified.",
						},
					},
					required: ["name", "command"],
				},
			},
			{
				name: "stop_service",
				description: "Stop a running background service by name.",
				inputSchema: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "The name of the service to stop",
						},
					},
					required: ["name"],
				},
			},
			{
				name: "expose_port",
				description:
					"Expose a port so the user can view it in their browser. After running a dev server with start_service, use this to make it viewable via the Preview URL.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "The port number to expose (e.g., 3000, 5173, 8080)",
						},
					},
					required: ["port"],
				},
			},
			{
				name: "list_services",
				description: "List all running and stopped services.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "get_preview_url",
				description:
					"Get the preview URL where the user can view exposed ports. Use this to tell the user the exact URL they can visit.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
		],
	};
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	try {
		switch (name) {
			case "start_service": {
				const {
					name: serviceName,
					command,
					cwd,
				} = args as {
					name: string;
					command: string;
					cwd?: string;
				};
				const service = await startService({ name: serviceName, command, cwd });
				return {
					content: [
						{
							type: "text",
							text: `Started service "${serviceName}" (PID: ${service.pid})\nCommand: ${command}\nLogs: ${service.logFile}`,
						},
					],
				};
			}

			case "stop_service": {
				const { name: serviceName } = args as { name: string };
				await stopService({ name: serviceName });
				return {
					content: [
						{
							type: "text",
							text: `Stopped service "${serviceName}"`,
						},
					],
				};
			}

			case "expose_port": {
				const { port } = args as { port: number };
				await exposePort(port);
				return {
					content: [
						{
							type: "text",
							text: `Exposed port ${port}. The user can now view it via their Preview URL.`,
						},
					],
				};
			}

			case "list_services": {
				const services = getServices();
				if (services.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No services are currently running.",
							},
						],
					};
				}
				const serviceList = services
					.map((s) => `- ${s.name}: ${s.status} (PID: ${s.pid})\n  Command: ${s.command}`)
					.join("\n");
				return {
					content: [
						{
							type: "text",
							text: `Services:\n${serviceList}`,
						},
					],
				};
			}

			case "get_preview_url": {
				if (!existsSync(PREVIEW_URL_FILE)) {
					return {
						content: [
							{
								type: "text",
								text: "Preview URL not available yet. The user can view exposed ports in their Preview panel.",
							},
						],
					};
				}
				const previewUrl = readFileSync(PREVIEW_URL_FILE, "utf-8").trim();
				return {
					content: [
						{
							type: "text",
							text: `Preview URL: ${previewUrl}\n\nThe user can view exposed ports at this URL or in their Preview panel.`,
						},
					],
				};
			}

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error: ${(error as Error).message}`,
				},
			],
			isError: true,
		};
	}
});

export async function startMcpServer(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("sandbox-mcp MCP server running on stdio");
}
