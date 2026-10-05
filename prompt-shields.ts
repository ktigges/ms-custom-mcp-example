import { createHash } from "node:crypto";

import type {
  PromptSecurityResult,
  PromptSecurityService,
} from "./service-contracts.js";

// Only the Prompt Shields fields needed for the allow-or-block decision.
interface PromptShieldResponse {
  userPromptAnalysis?: {
    attackDetected?: boolean;
  };
}

interface PromptShieldsConfiguration {
  apiKey: string;
  endpoint: string;
}

// Fail clearly if the container is missing required security configuration.
function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${name} is not configured.`);
  }
  return value;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// This example calls Azure AI Content Safety before a tool can call Graph.
export class PromptShieldsService implements PromptSecurityService {
  constructor(
    private readonly configuration: PromptShieldsConfiguration,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  static fromEnvironment(): PromptShieldsService {
    return new PromptShieldsService({
      apiKey: requiredEnvironmentValue("CONTENT_SAFETY_API_KEY"),
      endpoint: requiredEnvironmentValue("CONTENT_SAFETY_ENDPOINT"),
    });
  }

  async inspectPrompt(
    prompt: string,
    correlationId: string,
  ): Promise<PromptSecurityResult> {
    // The prompt is inspected before any Microsoft Graph request is allowed.
    const endpoint = this.configuration.endpoint.replace(/\/$/, "");
    const response = await this.fetchImplementation(
      `${endpoint}/contentsafety/text:shieldPrompt?api-version=2024-09-01`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": this.configuration.apiKey,
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({
          userPrompt: prompt,
          documents: [],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Prompt Shields failed with HTTP status ${response.status}.`,
      );
    }

    const body = (await response.json()) as PromptShieldResponse;
    const result: PromptSecurityResult = {
      attackDetected:
        body.userPromptAnalysis?.attackDetected ?? false,
      contentHash: hashContent(prompt),
      enabled: true,
    };

    // Log the verdict and hash, not another copy of the prompt.
    console.log(
      JSON.stringify({
        event: "prompt_security_evaluated",
        correlationId,
        ...result,
      }),
    );
    return result;
  }
}
