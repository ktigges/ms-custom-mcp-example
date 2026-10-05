import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import type { RequestContext } from "./request-context.js";
import type {
  GovernedM365Service,
  PromptSecurityService,
} from "./service-contracts.js";
import {
  getGovernedProfile,
  searchGovernedEmails,
} from "./tool-handlers.js";

// Runtime services are created by the container entry point and injected here.
export interface McpServerDependencies {
  m365: GovernedM365Service;
  promptSecurity: PromptSecurityService;
}

// This file is the tool catalog Copilot receives from tools/list.
export function createMcpServer(
  requestContext: RequestContext,
  dependencies: McpServerDependencies,
): McpServer {
  const server = new McpServer({
    name: "governed-m365-mcp",
    version: "1.0.0",
  });

  // Each registered tool is explicitly allow-listed and input constrained.
  server.registerTool(
    "search_governed_recent_emails",
    {
      title: "Search Governed Recent Emails",
      description:
        "Searches recent email after prompt security and Purview checks.",
      inputSchema: {
        // Zod validates arguments before the tool handler can run.
        conversationId: z.string().uuid(),
        daysBack: z.number().int().min(1).max(30),
        keywords: z.array(z.string().min(1)).min(1).max(5),
        testMarker: z.string().min(1),
        userPrompt: z.string().min(1),
      },
      annotations: {
        // These hints tell the MCP client that this is a read-only tool.
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      searchGovernedEmails(input, requestContext, dependencies),
  );

  // Copilot discovers this catalog through the MCP tools/list operation.
  server.registerTool(
    "get_governed_m365_profile",
    {
      title: "Get Governed Microsoft 365 Profile",
      description:
        "Reads the signed-in user's profile after security and Purview checks.",
      inputSchema: {
        // Profile access still requires correlation and the original prompt.
        conversationId: z.string().uuid(),
        testMarker: z.string().min(1),
        userPrompt: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) =>
      getGovernedProfile(input, requestContext, dependencies),
  );

  return server;
}
