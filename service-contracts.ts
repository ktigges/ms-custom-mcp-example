// Data returned by the allow-listed recent-email Graph operation.
export interface EmailSummary {
  bodyPreview: string;
  from: {
    address: string;
    name: string;
  };
  id: string;
  receivedDateTime: string;
  subject: string;
  webLink: string;
}

// Data returned by the allow-listed signed-in profile Graph operation.
export interface Profile {
  displayName: string;
  id: string;
  userPrincipalName: string;
}

// Purview returns the evaluation mode and any policy decision.
export interface PurviewResult {
  blocked: boolean;
  contentHash: string;
  mode: "audit" | "evaluateInline" | "evaluateOffline";
  policyActions: string[];
}

// Prompt Shields returns whether the prompt appears to contain an attack.
export interface PromptSecurityResult {
  attackDetected: boolean;
  contentHash: string;
  enabled: boolean;
}

// The production implementation performs OBO authentication and Microsoft
// Graph and Purview API calls.
export interface GovernedM365Service {
  // Exchange the incoming user token for a delegated Microsoft Graph token.
  acquireGraphToken(userAssertion: string): Promise<string>;

  // Run only the Graph operations explicitly implemented by this service.
  getProfile(
    graphToken: string,
    correlationId: string,
  ): Promise<Profile>;
  searchRecentEmails(
    graphToken: string,
    correlationId: string,
    receivedAfter: string,
    keywords: string[],
  ): Promise<EmailSummary[]>;

  // Submit prompt or response content to the existing Purview integration.
  governText(
    graphToken: string,
    activity: "uploadText" | "downloadText",
    content: string,
    conversationId: string,
    sequenceNumber: number,
    clientIp?: string,
  ): Promise<PurviewResult>;
}

// Keeping this as an interface makes the security service easy to test.
export interface PromptSecurityService {
  inspectPrompt(
    prompt: string,
    correlationId: string,
  ): Promise<PromptSecurityResult>;
}
