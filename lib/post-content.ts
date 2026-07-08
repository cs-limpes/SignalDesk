import type { SignalDraft } from "./types";

export interface AdditionalReferencesValidation {
  urls: string[];
  invalid: string[];
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrlKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

function normalizeHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function validateAdditionalReferences(
  values: string[],
  primarySourceUrl: string
): AdditionalReferencesValidation {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const primaryKey = normalizeUrlKey(primarySourceUrl);

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = normalizeHttpUrl(trimmed);
    if (!normalized) {
      invalid.push(trimmed);
      continue;
    }

    const key = normalizeUrlKey(normalized);
    if (key === primaryKey || seen.has(key)) {
      continue;
    }

    seen.add(key);
    urls.push(normalized);
  }

  return { urls, invalid };
}

export function parseAdditionalReferencesInput(
  value: string,
  primarySourceUrl: string
) {
  return validateAdditionalReferences(value.split(/\r?\n/), primarySourceUrl);
}

function referenceLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}

export function formatSourceDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function formatSourceAuthor(value?: string) {
  const author = value?.trim().replace(/^by\s+/i, "");
  return author ? `By ${author}` : "";
}

function sourcePublication(draft: SignalDraft) {
  return draft.sourceSiteName?.trim() || referenceLabel(draft.sourceUrl);
}

export function formatSourceCredit(draft: SignalDraft) {
  return [
    formatSourceDate(draft.sourcePublishedAt),
    sourcePublication(draft),
    formatSourceAuthor(draft.sourceByline),
  ]
    .filter(Boolean)
    .join(" | ");
}

function buildSourceBlock(draft: SignalDraft) {
  const sourceUrl = escapeHtml(draft.sourceUrl);
  const sourceCredit = escapeHtml(formatSourceCredit(draft));
  const creditLine = sourceCredit ? `${sourceCredit}<br>` : "";

  return `<p><strong>Source:</strong> ${creditLine}<a href="${sourceUrl}" rel="nofollow noopener">${sourceUrl}</a></p>`;
}

export function buildSignalPostContent(draft: SignalDraft) {
  const signal = escapeHtml(draft.signal);
  const sourceUrl = escapeHtml(draft.sourceUrl);
  const accessStatus = escapeHtml(draft.sourceAccessStatus);
  const references = validateAdditionalReferences(
    draft.additionalReferences ?? [],
    draft.sourceUrl
  ).urls;
  const furtherReading = references.length
    ? [
        `<p><strong>Further reading:</strong></p>`,
        `<ul>`,
        ...references.map((url) => {
          const href = escapeHtml(url);
          const label = escapeHtml(referenceLabel(url));
          return `<li><a href="${href}" rel="nofollow noopener">${label}</a></li>`;
        }),
        `</ul>`,
      ]
    : [];

  return [
    `<p><strong>Signal:</strong> ${signal}</p>`,
    buildSourceBlock(draft),
    ...furtherReading,
    `<!-- source_url: ${sourceUrl} -->`,
    `<!-- source_access_status: ${accessStatus} -->`,
  ].join("\n");
}
