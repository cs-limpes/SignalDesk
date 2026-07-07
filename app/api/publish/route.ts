import { requireAuth } from "@/lib/auth";
import { publishSignalPost } from "@/lib/wordpress";
import { jsonError, readJson } from "@/lib/route";
import type { PublishRequest } from "@/lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const payload = await readJson<PublishRequest>(request);

    if (!payload.draft?.title?.trim() || !payload.draft.signal?.trim()) {
      return Response.json(
        { error: "A title and Signal are required before WordPress action." },
        { status: 400 }
      );
    }

    if (payload.status !== "draft" && payload.status !== "publish") {
      return Response.json({ error: "Invalid WordPress status." }, { status: 400 });
    }

    const result = await publishSignalPost(payload);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
