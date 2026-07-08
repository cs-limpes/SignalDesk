import { env } from "cloudflare:workers";
import type { ArticleData, SignalDraft } from "./types";

interface RuntimeEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
}

const signalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      description: "A concise editorial WordPress post title.",
    },
    signal: {
      type: "string",
      description: "Two to four editorial sentences explaining why the story matters.",
    },
    excerpt: {
      type: "string",
      description: "A short WordPress excerpt for previews.",
    },
    suggestedCategory: {
      type: "string",
      description: "One suggested WordPress category name.",
    },
    suggestedTags: {
      type: "array",
      description: "Three to six relevant WordPress tag names.",
      items: { type: "string" },
    },
  },
  required: ["title", "signal", "excerpt", "suggestedCategory", "suggestedTags"],
};

function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

function extractOutputText(payload: OpenAIResponse) {
  if (payload.output_text) {
    return payload.output_text;
  }

  const parts =
    payload.output?.flatMap((item) =>
      item.content?.map((content) => content.text ?? content.refusal ?? "") ?? []
    ) ?? [];
  return parts.join("").trim();
}

function parseSignalDraft(text: string, article: ArticleData): SignalDraft {
  const parsed = JSON.parse(text) as Omit<
    SignalDraft,
    | "sourceUrl"
    | "sourceSiteName"
    | "sourceByline"
    | "sourcePublishedAt"
    | "sourceAccessStatus"
    | "additionalReferences"
  >;

  return {
    title: parsed.title.trim(),
    signal: parsed.signal.trim(),
    excerpt: parsed.excerpt.trim(),
    sourceUrl: article.url,
    sourceSiteName: article.siteName,
    sourceByline: article.byline,
    sourcePublishedAt: article.publishedAt,
    sourceAccessStatus: article.accessStatus,
    suggestedCategory: parsed.suggestedCategory.trim(),
    suggestedTags: parsed.suggestedTags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8),
    additionalReferences: [],
  };
}

export async function generateSignalDraft({
  article,
  observation,
  selectedCategory,
  selectedTags,
}: {
  article: ArticleData;
  observation: string;
  selectedCategory?: string;
  selectedTags?: string[];
}) {
  const runtimeEnv = getRuntimeEnv();
  const apiKey = runtimeEnv.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = runtimeEnv.OPENAI_MODEL?.trim() || "gpt-5.5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Create a short editorial Signal, not a neutral summary. Use the article content and the editor's observation to identify why this story matters. The Signal should be understandable without reading the article, but should invite readers to follow the source link. Integrate the editor's observation naturally. Do not invent facts. If source content is incomplete, rely only on the provided summary and editor observation. Avoid hype. Return only valid structured JSON.",
        },
        {
          role: "user",
          content: JSON.stringify({
            sourceAccessStatus: article.accessStatus,
            sourceUrl: article.url,
            sourceName: article.siteName,
            title: article.title,
            description: article.description,
            byline: article.byline,
            publishedAt: article.publishedAt,
            articleTextOrManualSummary: article.text,
            editorObservation: observation,
            selectedCategory,
            selectedTags,
          }),
        },
      ],
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "signal_post",
          schema: signalSchema,
          strict: true,
        },
      },
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenAI call failed with HTTP ${response.status}: ${bodyText.slice(0, 400)}`
    );
  }

  const payload = JSON.parse(bodyText) as OpenAIResponse;
  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI returned no draft text.");
  }

  return parseSignalDraft(outputText, article);
}
