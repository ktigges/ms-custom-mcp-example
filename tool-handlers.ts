import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { RequestContext } from "./request-context.js";
import type {
  GovernedM365Service,
  PromptSecurityService,
} from "./service-contracts.js";

// Dependencies are injected so tool behavior can be tested without live APIs.
export interface GovernedToolDependencies {
  m365: GovernedM365Service;
  promptSecurity: PromptSecurityService;
}

export interface CommonToolInput {
  conversationId: string;
  testMarker: string;
  userPrompt: string;
}

export interface SearchEmailsInput extends CommonToolInput {
  daysBack: number;
  keywords: string[];
}

// MCP tools return text content, so structured values are serialized as JSON.
function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// Block a detected jailbreak or prompt-injection attempt before Graph.
async function inspectPrompt(
  input: CommonToolInput,
  context: RequestContext,
  dependencies: GovernedToolDependencies,
): Promise<CallToolResult | undefined> {
  const security = await dependencies.promptSecurity.inspectPrompt(
    input.userPrompt,
    context.correlationId,
  );
  if (!security.attackDetected) {
    return undefined;
  }

  console.log(
    JSON.stringify({
      event: "governed_interaction_blocked",
      reason: "prompt_attack",
      conversationId: input.conversationId,
      correlationId: context.correlationId,
      promptHash: security.contentHash,
      testMarker: input.testMarker,
    }),
  );
  return errorResult(
    "The request was blocked by the prompt security policy.",
  );
}

async function prepareGraphCall(
  input: CommonToolInput,
  context: RequestContext,
  dependencies: GovernedToolDependencies,
): Promise<
  | { blockedResult: CallToolResult }
  | { graphToken: string; promptGovernance: Awaited<ReturnType<GovernedM365Service["governText"]>> }
> {
  // Every Graph-backed tool must pass Prompt Shields and Purview first.
  const securityBlock = await inspectPrompt(input, context, dependencies);
  if (securityBlock) {
    return { blockedResult: securityBlock };
  }

  if (!context.bearerToken) {
    return {
      blockedResult: errorResult(
        "The governed tool requires an authenticated user bearer token.",
      ),
    };
  }

  const graphToken = await dependencies.m365.acquireGraphToken(
    context.bearerToken,
  );
  const promptGovernance = await dependencies.m365.governText(
    graphToken,
    "uploadText",
    input.userPrompt,
    input.conversationId,
    0,
    context.clientIp,
  );
  if (promptGovernance.blocked) {
    // A Purview prompt block also prevents the downstream Graph request.
    return {
      blockedResult: errorResult(
        "Microsoft Purview blocked the user prompt.",
      ),
    };
  }

  return { graphToken, promptGovernance };
}

async function approveResponse(
  input: CommonToolInput,
  context: RequestContext,
  dependencies: GovernedToolDependencies,
  graphToken: string,
  value: unknown,
): Promise<CallToolResult> {
  // Graph data is evaluated by Purview before it can return to Copilot.
  const responseGovernance = await dependencies.m365.governText(
    graphToken,
    "downloadText",
    JSON.stringify(value),
    input.conversationId,
    1,
    context.clientIp,
  );
  if (responseGovernance.blocked) {
    return errorResult(
      "Microsoft Purview blocked the Microsoft 365 result.",
    );
  }

  return jsonResult({
    result: value,
    security: {
      promptShields: "allowed",
      purviewResponse: responseGovernance,
    },
    conversationId: input.conversationId,
    correlationId: context.correlationId,
    testMarker: input.testMarker,
  });
}

export async function getGovernedProfile(
  input: CommonToolInput,
  context: RequestContext,
  dependencies: GovernedToolDependencies,
): Promise<CallToolResult> {
  try {
    // Security checks complete before this allow-listed profile read.
    const prepared = await prepareGraphCall(input, context, dependencies);
    if ("blockedResult" in prepared) {
      return prepared.blockedResult;
    }

    const profile = await dependencies.m365.getProfile(
      prepared.graphToken,
      context.correlationId,
    );
    return approveResponse(
      input,
      context,
      dependencies,
      prepared.graphToken,
      profile,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "governed_interaction_failed",
        correlationId: context.correlationId,
        error: message,
        toolName: "get_governed_m365_profile",
      }),
    );
    return errorResult("The governed tool could not complete the request.");
  }
}

export async function searchGovernedEmails(
  input: SearchEmailsInput,
  context: RequestContext,
  dependencies: GovernedToolDependencies,
): Promise<CallToolResult> {
  try {
    // The same shared controls protect the allow-listed email read.
    const prepared = await prepareGraphCall(input, context, dependencies);
    if ("blockedResult" in prepared) {
      return prepared.blockedResult;
    }

    const receivedAfter = new Date(
      Date.now() - input.daysBack * 24 * 60 * 60 * 1000,
    ).toISOString();
    const emails = await dependencies.m365.searchRecentEmails(
      prepared.graphToken,
      context.correlationId,
      receivedAfter,
      input.keywords,
    );
    return approveResponse(
      input,
      context,
      dependencies,
      prepared.graphToken,
      {
        emails,
        query: {
          daysBack: input.daysBack,
          keywords: input.keywords,
          receivedAfter,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "governed_interaction_failed",
        correlationId: context.correlationId,
        error: message,
        toolName: "search_governed_recent_emails",
      }),
    );
    return errorResult("The governed tool could not complete the request.");
  }
}
