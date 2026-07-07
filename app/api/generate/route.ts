import { requireAuth } from "@/lib/auth";
import { fetchArticle } from "@/lib/article";
import { generateSignalDraft } from "@/lib/openai";
import { jsonError, readJson } from "@/lib/route";
import type { GenerateSignalRequest } from "@/lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const payload = await readJson<GenerateSignalRequest>(request);
    const observation = payload.observation?.trim() ?? "";

    if (!payload.url?.trim()) {
      return Response.json({ error: "Article URL is required." }, { status: 400 });
    }

    if (!observation) {
      return Response.json(
        { error: "What stood out to you is required." },
        { status: 400 }
      );
    }

    const article = await fetchArticle(payload.url, payload.manualSummary);
    const draft = await generateSignalDraft({
      article,
      observation,
      selectedCategory: payload.selectedCategory,
      selectedTags: payload.selectedTags,
    });

    return Response.json({
      article,
      draft,
      duplicate: { isDuplicate: false },
    });
  } catch (error) {
    return jsonError(error);
  }
}
