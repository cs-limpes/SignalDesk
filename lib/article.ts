import type { ArticleData, SourceAccessStatus } from "./types";

const MAX_ARTICLE_CHARS = 14000;

function decodeHtml(input: string) {
  return input
    .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number(value)))
    .replace(/&#x([a-f0-9]+);/gi, (_, value) =>
      String.fromCharCode(Number.parseInt(value, 16))
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(input: string) {
  return decodeHtml(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function parseAttributes(tag: string) {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g)) {
    attrs.set(match[1].toLowerCase(), decodeHtml(match[2]));
  }
  return attrs;
}

function extractMeta(html: string, url: string) {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key =
      attrs.get("property")?.toLowerCase() ??
      attrs.get("name")?.toLowerCase() ??
      "";
    const content = attrs.get("content")?.trim();
    if (key && content) {
      meta.set(key, content);
    }
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const hostname = new URL(url).hostname.replace(/^www\./, "");

  return {
    title:
      meta.get("og:title") ??
      meta.get("twitter:title") ??
      (titleMatch ? stripTags(titleMatch[1]) : ""),
    description:
      meta.get("og:description") ??
      meta.get("twitter:description") ??
      meta.get("description") ??
      "",
    siteName: meta.get("og:site_name") ?? hostname,
    byline: meta.get("author") ?? undefined,
    publishedAt:
      meta.get("article:published_time") ??
      meta.get("date") ??
      meta.get("dc.date") ??
      undefined,
  };
}

function getMainHtml(html: string) {
  const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (article) {
    return article;
  }

  const main = html.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main) {
    return main;
  }

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
  return body ?? html;
}

function extractArticleText(html: string) {
  const mainHtml = getMainHtml(html)
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<button[\s\S]*?<\/button>/gi, " ");

  const paragraphs = [...mainHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((paragraph) => paragraph.length >= 45);

  const text = paragraphs.length >= 2 ? paragraphs.join("\n\n") : stripTags(mainHtml);
  return text.slice(0, MAX_ARTICLE_CHARS);
}

function classifyAccess(text: string, manualSummary: string): SourceAccessStatus {
  if (manualSummary) {
    return "manual";
  }

  if (text.length >= 1600) {
    return "full";
  }

  if (text.length >= 300) {
    return "partial";
  }

  return "metadata_only";
}

export function normalizeArticleUrl(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Article URL must use http or https.");
  }
  parsed.hash = "";
  return parsed.toString();
}

export async function fetchArticle(
  rawUrl: string,
  rawManualSummary = ""
): Promise<ArticleData> {
  const url = normalizeArticleUrl(rawUrl);
  const manualSummary = rawManualSummary.trim();

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "NewsOfTheAISignal/1.0 (+private editorial workflow; article metadata extraction)",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Article fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xml")) {
      throw new Error("Article URL did not return readable HTML.");
    }

    const html = await response.text();
    const meta = extractMeta(html, url);
    const articleText = extractArticleText(html);
    const text = manualSummary || articleText;
    const accessStatus = classifyAccess(articleText, manualSummary);

    return {
      url,
      title: meta.title,
      description: meta.description,
      siteName: meta.siteName,
      byline: meta.byline,
      publishedAt: meta.publishedAt,
      text,
      accessStatus,
      manualSummaryUsed: Boolean(manualSummary),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Article fetch failed.";
    const hostname = new URL(url).hostname.replace(/^www\./, "");

    return {
      url,
      title: "",
      description: "",
      siteName: hostname,
      text: manualSummary,
      accessStatus: manualSummary ? "manual" : "metadata_only",
      manualSummaryUsed: Boolean(manualSummary),
      fetchError: message,
    };
  }
}
