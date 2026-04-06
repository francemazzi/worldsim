import type { AgentTool } from "../types/PluginTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
}

interface McpClient {
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<McpCallToolResult>;
  listTools(params?: { cursor?: string }): Promise<{ tools: McpToolDef[] }>;
}

interface McpCallToolResult {
  content?: McpContentBlock[];
  isError?: boolean;
}

type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; uri: string; text?: string };

/**
 * Wraps a single MCP tool as a worldsim AgentTool.
 *
 * Tool names are prefixed to avoid collisions:
 *   serverName="github", toolName="search" → "mcp_github_search"
 */
export function wrapMcpTool(
  client: McpClient,
  serverName: string,
  tool: McpToolDef,
  timeoutMs = 30_000,
): AgentTool {
  return {
    name: `mcp_${serverName}_${tool.name}`,
    description: tool.description ?? `MCP tool: ${tool.name}`,
    inputSchema: tool.inputSchema as Record<string, unknown>,

    async execute(input: unknown, _ctx: WorldContext): Promise<unknown> {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);

      try {
        const result = await client.callTool(
          {
            name: tool.name,
            arguments: (input as Record<string, unknown>) ?? {},
          },
          undefined,
          { signal: abortController.signal },
        );

        if (result.isError) {
          const errorText =
            result.content
              ?.filter(
                (c): c is { type: "text"; text: string } => c.type === "text",
              )
              .map((c) => c.text)
              .join("\n") ?? "MCP tool returned an error";
          return { error: errorText };
        }

        return convertMcpContent(result.content);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return {
            error: `MCP tool "${tool.name}" timed out after ${timeoutMs}ms`,
          };
        }
        return {
          error: `MCP tool "${tool.name}" failed: ${(err as Error).message}`,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function convertMcpContent(
  content: McpContentBlock[] | undefined,
): unknown {
  if (!content || content.length === 0) return { result: "OK (no content)" };

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "image") {
      parts.push(`[Image: ${block.mimeType}]`);
    } else if (block.type === "resource") {
      parts.push(block.text ?? `[Resource: ${block.uri}]`);
    }
  }

  return parts.length === 1 ? parts[0] : parts.join("\n");
}

/**
 * Lists tools from an MCP client and wraps them all as AgentTools.
 */
export async function listAndWrapMcpTools(
  client: McpClient,
  serverName: string,
  toolFilter?: string[],
  timeoutMs?: number,
): Promise<AgentTool[]> {
  const { tools } = await client.listTools();

  let filtered = tools;
  if (toolFilter && toolFilter.length > 0) {
    const allowed = new Set(toolFilter);
    filtered = tools.filter((t) => allowed.has(t.name));
  }

  return filtered.map((t) => wrapMcpTool(client, serverName, t, timeoutMs));
}
