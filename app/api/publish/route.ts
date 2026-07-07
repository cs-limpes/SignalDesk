import { requireAuth } from "@/lib/auth";
import {
  publishSignalPost,
  WordPressNonJsonResponseError,
} from "@/lib/wordpress";
import { jsonError, readJson } from "@/lib/route";
import type { PublishRequest } from "@/lib/types";

export const runtime = "edge";

export async function GET() {
  return Response.json(
    {
      ok: false,
      error: "SignalDesk publish endpoint requires POST.",
    },
    { status: 405 }
  );
}

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const payload = await readJson<PublishRequest>(request);

    if (!payload.draft?.title?.trim() || !payload.draft.signal?.trim()) {
      return Response.json(
        {
          ok: false,
          error: "A title and Signal are required before WordPress action.",
        },
        { status: 400 }
      );
    }

    if (payload.status !== "draft" && payload.status !== "publish") {
      return Response.json(
        { ok: false, error: "Invalid WordPress status." },
        { status: 400 }
      );
    }

    const result = await publishSignalPost(payload);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WordPressNonJsonResponseError) {
      console.error("SignalDesk publish failed with non-JSON WordPress response", {
        status: error.status,
        contentType: error.contentType,
        sourceHint: error.sourceHint,
        upstreamUrl: error.upstreamUrl,
        details: error.details,
      });

      return Response.json(
        {
          ok: false,
          error: error.message,
          status: error.status,
          sourceHint: error.sourceHint,
          details: error.details,
        },
        { status: 502 }
      );
    }

    console.error("SignalDesk publish failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(error);
  }
}
