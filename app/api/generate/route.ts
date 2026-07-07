import { getClientIp, requireAuth } from "@/lib/auth";
import { fetchArticle } from "@/lib/article";
import { generateSignalDraft } from "@/lib/openai";
import { jsonError, readJson } from "@/lib/route";
import {
  checkRateLimit,
  getDuplicateInfo,
  recordSourceUrl,
} from "@/lib/storage";
import type { GenerateSignalRequest } from "@/lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
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

    const rate = await checkRateLimit(
      `generate:${auth.identity}:${getClientIp(request)}`,
      20,
      60 * 60
    );
    if (!rate.allowed) {
      return Response.json(
        {
          error: "Generation rate limit reached.",
          retryAfterSeconds: rate.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const article = await fetchArticle(payload.url, payload.manualSummary);
    const duplicate = await getDuplicateInfo(article.url);
    const draft = await generateSignalDraft({
      article,
      observation,
      selectedCategory: payload.selectedCategory,
      selectedTags: payload.selectedTags,
    });

    let storageWarning: string | undefined;
    try {
      await recordSourceUrl(article.url, article.accessStatus);
    } catch (error) {
      storageWarning =
        error instanceof Error ? error.message : "Duplicate tracking failed.";
    }

    return Response.json({ article, draft, duplicate, storageWarning });
  } catch (error) {
    return jsonError(error);
  }
}
