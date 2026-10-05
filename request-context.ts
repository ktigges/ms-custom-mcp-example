// Request-specific identity and correlation values forwarded by APIM.
export interface RequestContext {
  bearerToken?: string;
  clientIp?: string;
  correlationId: string;
  userAgent?: string;
}
