import { env } from "cloudflare:workers";
import { buildSignalPostContent } from "./post-content";
import type { PublishRequest, PublishResponse, TaxonomyTerm } from "./types";

interface RuntimeEnv {
  WP_BASE_URL?: string;
  WP_USERNAME?: string;
  WP_APPLICATION_PASSWORD?: string;
  PUBLIC_APP_URL?: string;
}

interface WordPressTerm {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

interface WordPressPost {
  id: number;
  link: string;
  status: string;
}

interface WordPressErrorBody {
  message?: string;
  data?: {
    term_id?: number;
  };
}

export interface WordPressRestCheckResult {
  ok: boolean;
  status: number;
  contentType: string;
  sourceHint?: string;
  details?: string;
}

class WordPressError extends Error {
  constructor(
    message: string,
    readonly body: WordPressErrorBody | null
  ) {
    super(message);
  }
}

export class WordPressNonJsonResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string,
    readonly contentType: string,
    readonly sourceHint: string,
    readonly upstreamUrl: string
  ) {
    super(message);
  }
}

function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

function getConfig() {
  const runtimeEnv = getRuntimeEnv();
  const baseUrl = runtimeEnv.WP_BASE_URL?.trim().replace(/\/$/, "");
  const username = runtimeEnv.WP_USERNAME?.trim();
  const password = runtimeEnv.WP_APPLICATION_PASSWORD?.trim();
  const publicAppUrl = runtimeEnv.PUBLIC_APP_URL?.trim().replace(/\/$/, "");

  if (!baseUrl || !username || !password) {
    throw new Error("WordPress credentials are not configured.");
  }

  return {
    baseUrl,
    username,
    password,
    referer: publicAppUrl || baseUrl,
  };
}

function encodeBasicAuth(username: string, password: string) {
  const value = `${username}:${password}`;
  return btoa(value);
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function classifyNonJsonResponse(text: string, contentType: string) {
  const lower = text.toLowerCase();
  const lowerType = contentType.toLowerCase();

  if (lower.includes("cf-error-code") || lower.includes("cloudflare")) {
    return "Cloudflare HTML response";
  }
  if (lower.includes("wp-login.php") || lower.includes("wordpress login")) {
    return "WordPress login page";
  }
  if (lower.includes("rest_cookie_invalid_nonce")) {
    return "WordPress REST auth page";
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return "404 HTML page";
  }
  if (lower.includes("signaldesk") || lower.includes("news of the ai signal")) {
    return "SignalDesk app shell";
  }
  if (lowerType.includes("text/html") || lower.startsWith("<!doctype")) {
    return "HTML response";
  }
  return "non-JSON response";
}

function parseJsonResponse(text: string, contentType: string, status: number, url: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const details = previewText(text);
    const sourceHint = classifyNonJsonResponse(text, contentType);
    console.error("WordPress returned non-JSON response", {
      status,
      contentType,
      sourceHint,
      upstreamUrl: url,
      details,
    });
    throw new WordPressNonJsonResponseError(
      "WordPress returned non-JSON response",
      status,
      details,
      contentType,
      sourceHint,
      url
    );
  }
}

async function wpFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, username, password, referer } = getConfig();
  const url = `${baseUrl}${path}`;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  headers.set("Authorization", `Basic ${encodeBasicAuth(username, password)}`);
  headers.set("User-Agent", "SignalDesk/1.0 (+https://newsoftheai.com)");
  headers.set("Referer", referer);
  headers.set("Accept", "application/json");

  if (method === "POST" || method === "PUT") {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = parseJsonResponse(text, contentType, response.status, url);

  if (!response.ok) {
    const message =
      typeof body?.message === "string"
        ? body.message
        : `WordPress request failed with HTTP ${response.status}.`;
    throw new WordPressError(message, body as WordPressErrorBody | null);
  }

  return body;
}

export async function checkWordPressRestEndpoint(): Promise<WordPressRestCheckResult> {
  const { baseUrl, referer } = getConfig();
  const url = `${baseUrl}/wp-json/wp/v2/posts?per_page=1`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Referer: referer,
        "User-Agent": "SignalDesk/1.0 (+https://newsoftheai.com)",
      },
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    try {
      JSON.parse(text || "null");
    } catch {
      return {
        ok: false,
        status: response.status,
        contentType,
        sourceHint: classifyNonJsonResponse(text, contentType),
        details: previewText(text),
      };
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      details: response.ok
        ? undefined
        : previewText(text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      sourceHint: "network or configuration error",
      details: error instanceof Error ? error.message : "WordPress REST check failed.",
    };
  }
}

function mapTerm(term: WordPressTerm): TaxonomyTerm {
  return {
    id: term.id,
    name: term.name,
    slug: term.slug,
    count: term.count,
  };
}

export async function fetchTaxonomy() {
  const [categories, tags] = await Promise.all([
    wpFetch("/wp-json/wp/v2/categories?per_page=100&hide_empty=false"),
    wpFetch("/wp-json/wp/v2/tags?per_page=100&hide_empty=false"),
  ]);

  return {
    categories: (categories as WordPressTerm[]).map(mapTerm),
    tags: (tags as WordPressTerm[]).map(mapTerm),
  };
}

async function createTerm(kind: "categories" | "tags", name: string) {
  try {
    const term = (await wpFetch(`/wp-json/wp/v2/${kind}`, {
      method: "POST",
      body: JSON.stringify({ name }),
    })) as WordPressTerm;
    return mapTerm(term);
  } catch (error) {
    const termId = error instanceof WordPressError ? error.body?.data?.term_id : null;
    if (typeof termId === "number") {
      return { id: termId, name, slug: name.toLowerCase().replace(/\s+/g, "-") };
    }
    throw error;
  }
}

export async function createTag(name: string) {
  return createTerm("tags", name);
}

export async function createCategory(name: string) {
  return createTerm("categories", name);
}

async function resolveTaxonomy(request: PublishRequest) {
  const categories = [...(request.categoryId ? [request.categoryId] : [])];
  if (request.createCategoryName?.trim()) {
    const category = await createCategory(request.createCategoryName.trim());
    categories.push(category.id);
  }

  const newTags = await Promise.all(
    request.newTags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => createTag(tag))
  );

  return {
    categories,
    tags: [
      ...request.tagIds.filter((id) => Number.isFinite(id)),
      ...newTags.map((tag) => tag.id),
    ],
  };
}

async function createPost(payload: Record<string, unknown>) {
  return (await wpFetch("/wp-json/wp/v2/posts", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as WordPressPost;
}

export async function publishSignalPost(
  request: PublishRequest
): Promise<PublishResponse> {
  if (request.draft.sourceAccessStatus === "metadata_only") {
    throw new Error(
      "WordPress actions are disabled until readable article text or a manual summary is available."
    );
  }

  const { baseUrl } = getConfig();
  const taxonomy = await resolveTaxonomy(request);
  const payload = {
    title: request.draft.title,
    content: buildSignalPostContent(request.draft),
    excerpt: request.draft.excerpt,
    status: request.status,
    categories: taxonomy.categories,
    tags: taxonomy.tags,
    meta: {
      source_url: request.draft.sourceUrl,
      source_access_status: request.draft.sourceAccessStatus,
    },
  };

  let post: WordPressPost;
  try {
    post = await createPost(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("meta")) {
      throw error;
    }

    const payloadWithoutMeta = { ...payload };
    delete payloadWithoutMeta.meta;
    post = await createPost(payloadWithoutMeta);
  }

  return {
    id: post.id,
    link: post.link,
    editLink: `${baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
    status: request.status,
  };
}
