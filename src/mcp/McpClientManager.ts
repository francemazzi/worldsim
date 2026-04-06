import type { AgentTool } from "../types/PluginTypes.js";
import type { McpServerConfig } from "../types/AgentTypes.js";
import { listAndWrapMcpTools } from "./McpToolAdapter.js";

interface ManagedMcpClient {
  serverName: string;
  client: { close(): Promise<void> };
  transport: { close(): Promise<void> };
  tools: AgentTool[];
}

/**
 * Manages MCP client connections for all agents.
 * Created once per WorldEngine; each agent gets its own client instances.
 */
export class McpClientManager {
  private connections = new Map<string, ManagedMcpClient[]>();

  /**
   * Connect to all MCP servers configured for an agent.
   * Returns the wrapped AgentTool[] from all servers combined.
   */
  async connectAgent(
    agentId: string,
    configs: McpServerConfig[],
  ): Promise<AgentTool[]> {
    const clients: ManagedMcpClient[] = [];
    const allTools: AgentTool[] = [];

    for (const config of configs) {
      try {
        const { client, transport } = await this.createClient(config);

        const tools = await listAndWrapMcpTools(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client as any,
          config.name,
          config.toolFilter,
          config.toolCallTimeoutMs,
        );

        clients.push({ serverName: config.name, client, transport, tools });
        allTools.push(...tools);

        console.log(
          `[MCP] Agent "${agentId}" connected to "${config.name}" ` +
            `(${tools.length} tools: ${tools.map((t) => t.name).join(", ")})`,
        );
      } catch (err) {
        console.warn(
          `[MCP] Agent "${agentId}" failed to connect to "${config.name}":`,
          (err as Error).message,
        );
      }
    }

    if (clients.length > 0) {
      this.connections.set(agentId, clients);
    }

    return allTools;
  }

  /** Disconnect all MCP servers for a specific agent. */
  async disconnectAgent(agentId: string): Promise<void> {
    const clients = this.connections.get(agentId);
    if (!clients) return;

    for (const { serverName, client, transport } of clients) {
      try {
        await client.close();
        await transport.close();
      } catch (err) {
        console.warn(
          `[MCP] Failed to disconnect "${serverName}" for agent "${agentId}":`,
          (err as Error).message,
        );
      }
    }

    this.connections.delete(agentId);
  }

  /** Disconnect all agents. Called during world stop. */
  async disconnectAll(): Promise<void> {
    const agentIds = [...this.connections.keys()];
    await Promise.all(agentIds.map((id) => this.disconnectAgent(id)));
  }

  /** Check if any agent has MCP connections. */
  get hasConnections(): boolean {
    return this.connections.size > 0;
  }

  private async createClient(config: McpServerConfig): Promise<{
    client: { close(): Promise<void> };
    transport: { close(): Promise<void> };
  }> {
    const { Client } = await import("@modelcontextprotocol/sdk/client");

    const client = new Client(
      { name: "worldsim", version: "1.0.0" },
      { capabilities: {} },
    );

    let transport: { close(): Promise<void>; start?(): Promise<void> };

    if (config.transport === "stdio") {
      if (!config.command) {
        throw new Error(`MCP stdio server "${config.name}" missing "command"`);
      }
      const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio"
      );
      const stdioParams: Record<string, unknown> = {
        command: config.command,
      };
      if (config.args) stdioParams.args = config.args;
      if (config.env) stdioParams.env = config.env;
      if (config.cwd) stdioParams.cwd = config.cwd;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport = new StdioClientTransport(stdioParams as any);
    } else if (config.transport === "http") {
      if (!config.url) {
        throw new Error(`MCP HTTP server "${config.name}" missing "url"`);
      }
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp"
      );
      const httpOpts: Record<string, unknown> = {};
      if (config.headers) httpOpts.requestInit = { headers: config.headers };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport = new StreamableHTTPClientTransport(new URL(config.url), httpOpts as any);
    } else {
      throw new Error(
        `MCP server "${config.name}": unsupported transport "${String(config.transport)}"`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.connect(transport as any);
    return { client, transport };
  }
}
