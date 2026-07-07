import { env } from "cloudflare:workers";
import { requireAuth } from "@/lib/auth";
import { jsonError } from "@/lib/route";
import { checkWordPressRestEndpoint } from "@/lib/wordpress";

interface RuntimeEnv {
  WP_BASE_URL?: string;
  WP_USERNAME?: string;
  WP_APPLICATION_PASSWORD?: string;
  AUTH_SHARED_SECRET?: string;
}

export const runtime = "edge";

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

export async function GET(request: Request) {
  try {
    requireAuth(request);

    const runtimeEnv = env as unknown as RuntimeEnv;
    const environment = {
      WP_BASE_URL: configured(runtimeEnv.WP_BASE_URL),
      WP_USERNAME: configured(runtimeEnv.WP_USERNAME),
      WP_APPLICATION_PASSWORD: configured(runtimeEnv.WP_APPLICATION_PASSWORD),
      AUTH_SHARED_SECRET: configured(runtimeEnv.AUTH_SHARED_SECRET),
    };

    const wordpressRest = environment.WP_BASE_URL
      ? await checkWordPressRestEndpoint()
      : {
          ok: false,
          status: 0,
          contentType: "",
          sourceHint: "missing WP_BASE_URL",
          details: "WP_BASE_URL is not configured.",
        };

    return Response.json({
      ok: Object.values(environment).every(Boolean) && wordpressRest.ok,
      environment,
      wordpressRest,
    });
  } catch (error) {
    return jsonError(error);
  }
}
