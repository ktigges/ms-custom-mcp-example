# Custom MCP Server

This directory contains five TypeScript source files showing a custom,
allow-listed MCP tool catalog with security checks before Microsoft Graph.

## Code

- `mcp-server.ts` registers the tools Copilot can discover.
- `tool-handlers.ts` runs Prompt Shields, Purview, Graph, and response checks.
- `prompt-shields.ts` calls Azure AI Content Safety Prompt Shields.
- `service-contracts.ts` defines the Graph, Purview, and security interfaces.
- `request-context.ts` carries authentication and correlation data.

The processing order is:

```text
Prompt Shields -> Purview prompt check -> Graph -> Purview response check
```

If Prompt Shields or Purview blocks the prompt, Graph is not called. If
Purview blocks the response, Graph data is not returned to Copilot.

## Why this helps

Cowork or another agent may call Microsoft Graph directly instead of going
through the native Copilot pipeline. In that case, we cannot assume the
Copilot-specific prompt inspection, response inspection, or interaction logs
will be available.

This custom MCP server provides a controlled route for those calls. It checks
the prompt for jailbreak or prompt-injection attacks, submits it to Purview,
allows only the Graph tools and permissions defined in code, checks the Graph
result before returning it, and records the full correlation trail.

This does not replace Entra, Graph, Exchange, or other Microsoft 365 controls.
It adds the application-level inspection and logging that may be missing when
an agent calls Graph outside the native Copilot pipeline.

## Required to make this a standalone repository

Add:

- `package.json` with the MCP SDK, Zod, TypeScript, and Microsoft identity
  dependencies.
- `tsconfig.json` that compiles `*.ts` files into `dist/`.
- `index.ts` that exposes `/health` and `/mcp` using MCP Streamable HTTP.
- A concrete `GovernedM365Service` implementation for OBO authentication,
  Microsoft Graph, and the existing Purview APIs.
- Runtime configuration supplied through environment variables or a secret
  store. Do not put credentials in source control.

Typical runtime settings:

```text
AZURE_TENANT_ID
AZURE_CLIENT_ID
AZURE_CLIENT_SECRET
APIM_BACKEND_SHARED_SECRET
APPLICATIONINSIGHTS_CONNECTION_STRING
CONTENT_SAFETY_ENDPOINT
CONTENT_SAFETY_API_KEY
```

## Sample Dockerfile

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY ./*.ts ./
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

The build stage copies the TypeScript source into the image and compiles it.
The final image contains only production dependencies and compiled JavaScript.

## Sample Docker Compose

```yaml
services:
  custom-mcp:
    build: .
    image: custom-mcp:local
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      AZURE_TENANT_ID: "${AZURE_TENANT_ID}"
      AZURE_CLIENT_ID: "${AZURE_CLIENT_ID}"
      AZURE_CLIENT_SECRET: "${AZURE_CLIENT_SECRET}"
      APIM_BACKEND_SHARED_SECRET: "${APIM_BACKEND_SHARED_SECRET}"
      APPLICATIONINSIGHTS_CONNECTION_STRING: "${APPLICATIONINSIGHTS_CONNECTION_STRING}"
      CONTENT_SAFETY_ENDPOINT: "${CONTENT_SAFETY_ENDPOINT}"
      CONTENT_SAFETY_API_KEY: "${CONTENT_SAFETY_API_KEY}"
    restart: unless-stopped
```

Store the values in a protected environment file or secret store, then build
and start the container:

```bash
docker compose --env-file .env up -d --build
curl http://127.0.0.1:3000/health
```

APIM can then route the customer-facing MCP endpoint to this container through
the selected private or public ingress method.
