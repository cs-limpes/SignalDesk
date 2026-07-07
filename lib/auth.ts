import { env } from "cloudflare:workers";

interface RuntimeEnv {
  AUTH_SHARED_SECRET?: string;
}

export interface AuthResult {
  ok: boolean;
  identity: string;
  mode: "cloudflare_access" | "openai_workspace" | "shared_secret" | "local";
}

function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function getProvidedSecret(request: Request) {
  return (
    request.headers.get("x-signal-auth")?.trim() ??
    getBearerToken(request)
  );
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function requireAuth(request: Request): AuthResult {
  const cloudflareUser = request.headers.get("cf-access-authenticated-user-email");
  if (cloudflareUser) {
    return {
      ok: true,
      identity: cloudflareUser,
      mode: "cloudflare_access",
    };
  }

  const openAiUser = request.headers.get("oai-authenticated-user-email");
  if (openAiUser) {
    return {
      ok: true,
      identity: openAiUser,
      mode: "openai_workspace",
    };
  }

  const sharedSecret = getRuntimeEnv().AUTH_SHARED_SECRET?.trim();
  if (sharedSecret) {
    const providedSecret = getProvidedSecret(request);
    if (providedSecret === sharedSecret) {
      return {
        ok: true,
        identity: "shared-secret-user",
        mode: "shared_secret",
      };
    }

    throw new Response(
      JSON.stringify({ error: "Authentication required." }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      }
    );
  }

  if (isLocalRequest(request)) {
    return {
      ok: true,
      identity: "local-development",
      mode: "local",
    };
  }

  throw new Response(
    JSON.stringify({
      error:
        "Authentication required. Configure Cloudflare Access or AUTH_SHARED_SECRET.",
    }),
    {
      status: 401,
      headers: { "content-type": "application/json" },
    }
  );
}

export function getClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
