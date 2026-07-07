import { requireAuth } from "@/lib/auth";
import { fetchArticle } from "@/lib/article";
import { jsonError, readJson } from "@/lib/route";

interface ArticleRequest {
  url?: string;
  manualSummary?: string;
}

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    requireAuth(request);
    const payload = await readJson<ArticleRequest>(request);
    if (!payload.url?.trim()) {
      return Response.json({ error: "Article URL is required." }, { status: 400 });
    }

    const article = await fetchArticle(payload.url, payload.manualSummary);
    return Response.json({ article });
  } catch (error) {
    return jsonError(error);
  }
}
