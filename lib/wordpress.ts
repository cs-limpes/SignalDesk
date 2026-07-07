import { env } from "cloudflare:workers";
import type { PublishRequest, PublishResponse, TaxonomyTerm } from "./types";

interface RuntimeEnv {
  WP_BASE_URL?: string;
  WP_USERNAME?: string;
  WP_APPLICATION_PASSWORD?: string;
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

class WordPressError extends Error {
  constructor(
    message: string,
    readonly body: WordPressErrorBody | null
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

  if (!baseUrl || !username || !password) {
    throw new Error("WordPress credentials are not configured.");
  }

  return { baseUrl, username, password };
}

function encodeBasicAuth(username: string, password: string) {
  const value = `${username}:${password}`;
  return btoa(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function wpFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, username, password } = getConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${encodeBasicAuth(username, password)}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof body?.message === "string"
        ? body.message
        : `WordPress request failed with HTTP ${response.status}.`;
    throw new WordPressError(message, body as WordPressErrorBody | null);
  }

  return body;
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

function buildPostContent(request: PublishRequest) {
  const { draft } = request;
  const signal = escapeHtml(draft.signal);
  const sourceUrl = escapeHtml(draft.sourceUrl);
  const accessStatus = escapeHtml(draft.sourceAccessStatus);

  return [
    `<p><strong>Signal:</strong> ${signal}</p>`,
    `<p><a href="${sourceUrl}" rel="nofollow noopener">Source</a></p>`,
    `<!-- source_url: ${sourceUrl} -->`,
    `<!-- source_access_status: ${accessStatus} -->`,
  ].join("\n");
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
    content: buildPostContent(request),
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
