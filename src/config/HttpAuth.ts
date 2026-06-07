import type { FastifyReply, FastifyRequest } from "fastify";

export function isSessionTokenAuthorized(
  configuredToken: string | null | undefined,
  providedToken: string | null | undefined,
): boolean {
  return !configuredToken || providedToken === configuredToken;
}

export function extractSessionToken(request: FastifyRequest): string | null {
  const queryToken = (request.query as Record<string, string | undefined> | undefined)?.token;
  const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const headerToken = request.headers["x-agentix-session-token"];
  const explicitHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return queryToken ?? authorization ?? explicitHeader ?? null;
}

export function requireSessionToken(
  request: FastifyRequest,
  reply: FastifyReply,
  configuredToken: string | null | undefined,
): boolean {
  if (isSessionTokenAuthorized(configuredToken, extractSessionToken(request))) {
    return true;
  }
  reply.code(401).send({ error: "unauthorized" });
  return false;
}
