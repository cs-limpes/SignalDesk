import type { SignalDraft } from "./types";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSignalPostContent(draft: SignalDraft) {
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
