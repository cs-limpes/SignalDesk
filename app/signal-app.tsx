"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  ArticleData,
  GenerateSignalResponse,
  PublishResponse,
  PublishStatus,
  SignalDraft,
  TaxonomyTerm,
} from "@/lib/types";

type Screen = "submit" | "preview" | "success";

interface TaxonomyState {
  categories: TaxonomyTerm[];
  tags: TaxonomyTerm[];
  error: string;
  loading: boolean;
}

const emptyTaxonomy: TaxonomyState = {
  categories: [],
  tags: [],
  error: "",
  loading: true,
};

const accessLabels: Record<SignalDraft["sourceAccessStatus"], string> = {
  full: "full text",
  partial: "partial text",
  metadata_only: "metadata only",
  manual: "manual summary",
};

function splitTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SignalApp() {
  const [screen, setScreen] = useState<Screen>("submit");
  const [articleUrl, setArticleUrl] = useState("");
  const [observation, setObservation] = useState("");
  const [manualSummary, setManualSummary] = useState("");
  const [authToken, setAuthToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.sessionStorage.getItem("signal-auth-token") ?? ""
  );
  const [taxonomy, setTaxonomy] = useState<TaxonomyState>(emptyTaxonomy);
  const [categoryId, setCategoryId] = useState("");
  const [createCategoryName, setCreateCategoryName] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [newTagsText, setNewTagsText] = useState("");
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [draft, setDraft] = useState<SignalDraft | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [success, setSuccess] = useState<PublishResponse | null>(null);

  const selectedCategoryName = useMemo(() => {
    const selected = taxonomy.categories.find(
      (category) => String(category.id) === categoryId
    );
    return createCategoryName.trim() || selected?.name || "";
  }, [categoryId, createCategoryName, taxonomy.categories]);

  const selectedTagNames = useMemo(() => {
    const existing = taxonomy.tags
      .filter((tag) => selectedTagIds.includes(tag.id))
      .map((tag) => tag.name);
    return [...existing, ...splitTags(newTagsText)];
  }, [newTagsText, selectedTagIds, taxonomy.tags]);

  const wordpressBlocked =
    draft?.sourceAccessStatus === "metadata_only" && !manualSummary.trim();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem("signal-auth-token", authToken);
  }, [authToken]);

  useEffect(() => {
    void loadTaxonomy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiFetch<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(authToken ? { "x-signal-auth": authToken } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? `Request failed with HTTP ${response.status}.`);
    }
    return body as T;
  }

  async function loadTaxonomy() {
    setTaxonomy((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await apiFetch<{
        categories: TaxonomyTerm[];
        tags: TaxonomyTerm[];
      }>("/api/taxonomy");
      setTaxonomy({ ...data, loading: false, error: "" });
      if (!categoryId && data.categories[0]) {
        setCategoryId(String(data.categories[0].id));
      }
    } catch (error) {
      setTaxonomy({
        categories: [],
        tags: [],
        loading: false,
        error: getErrorMessage(error),
      });
    }
  }

  async function generateSignal(event?: FormEvent) {
    event?.preventDefault();
    setBusyAction("generate");
    setErrorMessage("");
    setStatusMessage("");
    setDuplicateMessage("");

    try {
      const response = await apiFetch<GenerateSignalResponse>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          url: articleUrl,
          observation,
          manualSummary,
          selectedCategory: selectedCategoryName,
          selectedTags: selectedTagNames,
        }),
      });

      setArticle(response.article);
      setDraft(response.draft);
      if (response.duplicate.isDuplicate) {
        setDuplicateMessage(
          `This source was already used ${response.duplicate.generateCount ?? 1} time(s).`
        );
      }
      if (response.storageWarning) {
        setStatusMessage(response.storageWarning);
      }
      setScreen("preview");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  function updateDraft<K extends keyof SignalDraft>(key: K, value: SignalDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
  }

  async function sendToWordPress(status: PublishStatus) {
    if (!draft) {
      return;
    }

    if (wordpressBlocked) {
      setErrorMessage(
        "Add a manual summary or use a readable URL before sending this Signal to WordPress."
      );
      return;
    }

    if (status === "publish" && !window.confirm("Publish this Signal now?")) {
      return;
    }

    setBusyAction(status);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const result = await apiFetch<PublishResponse>("/api/publish", {
        method: "POST",
        body: JSON.stringify({
          draft,
          categoryId: categoryId ? Number(categoryId) : undefined,
          categoryName: selectedCategoryName || undefined,
          createCategoryName: createCategoryName.trim() || undefined,
          tagIds: selectedTagIds,
          newTags: splitTags(newTagsText),
          status,
        }),
      });

      setSuccess(result);
      setScreen("success");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  function resetWorkflow() {
    setScreen("submit");
    setArticleUrl("");
    setObservation("");
    setManualSummary("");
    setArticle(null);
    setDraft(null);
    setSuccess(null);
    setErrorMessage("");
    setStatusMessage("");
    setDuplicateMessage("");
  }

  return (
    <main className="min-h-screen bg-[#f5f7f5] text-[#18201c]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-[#d5ddd6] pb-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[#5c6b63]">
              Private editorial PWA
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-[#15251f]">
              News of the AI Signal
            </h1>
          </div>
          <div className="min-w-0 text-right">
            <span className="inline-flex rounded-md border border-[#b9c6be] bg-white px-3 py-1 text-xs font-medium text-[#40564b]">
              {screen === "success" ? "sent" : screen}
            </span>
          </div>
        </header>

        {(errorMessage || statusMessage || duplicateMessage) && (
          <section className="mt-4 grid gap-2">
            {errorMessage && (
              <div className="rounded-md border border-[#e0b29b] bg-[#fff4ed] px-3 py-2 text-sm leading-6 text-[#763818]">
                {errorMessage}
              </div>
            )}
            {statusMessage && (
              <div className="rounded-md border border-[#c8d6dd] bg-[#eef6f8] px-3 py-2 text-sm leading-6 text-[#294d5a]">
                {statusMessage}
              </div>
            )}
            {duplicateMessage && (
              <div className="rounded-md border border-[#d7c98d] bg-[#fff9db] px-3 py-2 text-sm leading-6 text-[#5f5012]">
                {duplicateMessage}
              </div>
            )}
          </section>
        )}

        {screen === "submit" && (
          <SubmitScreen
            articleUrl={articleUrl}
            authToken={authToken}
            busy={busyAction === "generate"}
            categoryId={categoryId}
            createCategoryName={createCategoryName}
            manualSummary={manualSummary}
            newTagsText={newTagsText}
            observation={observation}
            selectedTagIds={selectedTagIds}
            setArticleUrl={setArticleUrl}
            setAuthToken={setAuthToken}
            setCategoryId={setCategoryId}
            setCreateCategoryName={setCreateCategoryName}
            setManualSummary={setManualSummary}
            setNewTagsText={setNewTagsText}
            setObservation={setObservation}
            taxonomy={taxonomy}
            toggleTag={toggleTag}
            onGenerate={generateSignal}
            onReloadTaxonomy={loadTaxonomy}
          />
        )}

        {screen === "preview" && draft && (
          <PreviewScreen
            article={article}
            busyAction={busyAction}
            categoryId={categoryId}
            createCategoryName={createCategoryName}
            draft={draft}
            newTagsText={newTagsText}
            selectedTagIds={selectedTagIds}
            setCategoryId={setCategoryId}
            setCreateCategoryName={setCreateCategoryName}
            setNewTagsText={setNewTagsText}
            taxonomy={taxonomy}
            toggleTag={toggleTag}
            updateDraft={updateDraft}
            wordpressBlocked={wordpressBlocked}
            onBack={() => setScreen("submit")}
            onPublish={sendToWordPress}
            onRegenerate={() => generateSignal()}
          />
        )}

        {screen === "success" && success && (
          <SuccessScreen result={success} onCreateAnother={resetWorkflow} />
        )}
      </div>
    </main>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-sm font-medium text-[#26332d]">{children}</span>;
}

function SubmitScreen({
  articleUrl,
  authToken,
  busy,
  categoryId,
  createCategoryName,
  manualSummary,
  newTagsText,
  observation,
  selectedTagIds,
  setArticleUrl,
  setAuthToken,
  setCategoryId,
  setCreateCategoryName,
  setManualSummary,
  setNewTagsText,
  setObservation,
  taxonomy,
  toggleTag,
  onGenerate,
  onReloadTaxonomy,
}: {
  articleUrl: string;
  authToken: string;
  busy: boolean;
  categoryId: string;
  createCategoryName: string;
  manualSummary: string;
  newTagsText: string;
  observation: string;
  selectedTagIds: number[];
  setArticleUrl: (value: string) => void;
  setAuthToken: (value: string) => void;
  setCategoryId: (value: string) => void;
  setCreateCategoryName: (value: string) => void;
  setManualSummary: (value: string) => void;
  setNewTagsText: (value: string) => void;
  setObservation: (value: string) => void;
  taxonomy: TaxonomyState;
  toggleTag: (tagId: number) => void;
  onGenerate: (event: FormEvent) => void;
  onReloadTaxonomy: () => void;
}) {
  return (
    <form
      className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]"
      onSubmit={onGenerate}
    >
      <section className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-white p-4 shadow-sm">
        <label className="space-y-2">
          <FieldLabel>Article URL</FieldLabel>
          <input
            className="h-12 w-full rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 text-base outline-none transition focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setArticleUrl(event.target.value)}
            placeholder="https://example.com/ai-news"
            required
            type="url"
            value={articleUrl}
          />
        </label>

        <label className="space-y-2">
          <FieldLabel>What stood out to you?</FieldLabel>
          <textarea
            className="min-h-32 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none transition focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setObservation(event.target.value)}
            placeholder="The shift, risk, pattern, or implication you noticed."
            required
            value={observation}
          />
        </label>

        <label className="space-y-2">
          <FieldLabel>Manual summary</FieldLabel>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none transition focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setManualSummary(event.target.value)}
            placeholder="Use this when the source is blocked or paywalled."
            value={manualSummary}
          />
        </label>

        <button
          className="mt-auto h-12 rounded-md bg-[#244658] px-4 text-base font-semibold text-white transition hover:bg-[#193747] focus:outline-none focus:ring-2 focus:ring-[#7ba8bc] disabled:bg-[#8b9891]"
          disabled={busy}
          type="submit"
        >
          {busy ? "Generating..." : "Generate Signal"}
        </button>
      </section>

      <aside className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-[#fcfdfb] p-4 shadow-sm">
        <label className="space-y-2">
          <FieldLabel>Auth token</FieldLabel>
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setAuthToken(event.target.value)}
            placeholder="AUTH_SHARED_SECRET"
            type="password"
            value={authToken}
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Category</FieldLabel>
            <button
              className="text-sm font-semibold text-[#2f6275]"
              onClick={onReloadTaxonomy}
              type="button"
            >
              Refresh
            </button>
          </div>
          <select
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            <option value="">No category</option>
            {taxonomy.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setCreateCategoryName(event.target.value)}
            placeholder="Create category"
            value={createCategoryName}
          />
        </div>

        <div className="space-y-2">
          <FieldLabel>Tags</FieldLabel>
          <div className="grid max-h-44 gap-2 overflow-auto rounded-md border border-[#d5ddd6] bg-white p-2">
            {taxonomy.tags.length === 0 && (
              <p className="px-1 text-sm text-[#66746c]">
                {taxonomy.loading
                  ? "Loading tags..."
                  : taxonomy.error || "No tags loaded."}
              </p>
            )}
            {taxonomy.tags.map((tag) => (
              <label
                className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-[#eef5f1]"
                key={tag.id}
              >
                <input
                  checked={selectedTagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                  type="checkbox"
                />
                {tag.name}
              </label>
            ))}
          </div>
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setNewTagsText(event.target.value)}
            placeholder="New tags, comma separated"
            value={newTagsText}
          />
        </div>
      </aside>
    </form>
  );
}

function PreviewScreen({
  article,
  busyAction,
  categoryId,
  createCategoryName,
  draft,
  newTagsText,
  selectedTagIds,
  setCategoryId,
  setCreateCategoryName,
  setNewTagsText,
  taxonomy,
  toggleTag,
  updateDraft,
  wordpressBlocked,
  onBack,
  onPublish,
  onRegenerate,
}: {
  article: ArticleData | null;
  busyAction: string;
  categoryId: string;
  createCategoryName: string;
  draft: SignalDraft;
  newTagsText: string;
  selectedTagIds: number[];
  setCategoryId: (value: string) => void;
  setCreateCategoryName: (value: string) => void;
  setNewTagsText: (value: string) => void;
  taxonomy: TaxonomyState;
  toggleTag: (tagId: number) => void;
  updateDraft: <K extends keyof SignalDraft>(key: K, value: SignalDraft[K]) => void;
  wordpressBlocked: boolean;
  onBack: () => void;
  onPublish: (status: PublishStatus) => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
      <div className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-[#5c6b63]">
              Source
            </p>
            <h2 className="text-lg font-semibold text-[#15251f]">
              {article?.title || "Untitled source"}
            </h2>
          </div>
          <span className="rounded-md bg-[#e6f0ea] px-3 py-1 text-xs font-semibold text-[#315d4a]">
            {accessLabels[draft.sourceAccessStatus]}
          </span>
        </div>

        {wordpressBlocked && (
          <div className="rounded-md border border-[#e0b29b] bg-[#fff4ed] px-3 py-2 text-sm leading-6 text-[#763818]">
            WordPress actions are disabled until readable article text or a
            manual summary is available.
          </div>
        )}

        {article?.fetchError && (
          <div className="rounded-md border border-[#d7c98d] bg-[#fff9db] px-3 py-2 text-sm leading-6 text-[#5f5012]">
            {article.fetchError}
          </div>
        )}

        <label className="space-y-2">
          <FieldLabel>Title</FieldLabel>
          <input
            className="h-12 w-full rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => updateDraft("title", event.target.value)}
            value={draft.title}
          />
        </label>

        <label className="space-y-2">
          <FieldLabel>Signal</FieldLabel>
          <textarea
            className="min-h-48 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base leading-7 outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => updateDraft("signal", event.target.value)}
            value={draft.signal}
          />
        </label>

        <label className="space-y-2">
          <FieldLabel>Excerpt</FieldLabel>
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => updateDraft("excerpt", event.target.value)}
            value={draft.excerpt}
          />
        </label>

        <a
          className="break-all text-sm font-medium text-[#2f6275]"
          href={draft.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {draft.sourceUrl}
        </a>
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-[#fcfdfb] p-4 shadow-sm">
        <button
          className="h-11 rounded-md border border-[#9fb1a8] bg-white px-3 text-sm font-semibold text-[#2f4a3d]"
          onClick={onBack}
          type="button"
        >
          Back
        </button>

        <div className="space-y-2">
          <FieldLabel>Category</FieldLabel>
          <select
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setCategoryId(event.target.value)}
            value={categoryId}
          >
            <option value="">No category</option>
            {taxonomy.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setCreateCategoryName(event.target.value)}
            placeholder={draft.suggestedCategory || "Create category"}
            value={createCategoryName}
          />
        </div>

        <div className="space-y-2">
          <FieldLabel>Tags</FieldLabel>
          <div className="grid max-h-44 gap-2 overflow-auto rounded-md border border-[#d5ddd6] bg-white p-2">
            {taxonomy.tags.map((tag) => (
              <label
                className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-[#eef5f1]"
                key={tag.id}
              >
                <input
                  checked={selectedTagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                  type="checkbox"
                />
                {tag.name}
              </label>
            ))}
            {taxonomy.tags.length === 0 && (
              <p className="px-1 text-sm text-[#66746c]">No WordPress tags loaded.</p>
            )}
          </div>
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setNewTagsText(event.target.value)}
            placeholder={draft.suggestedTags.join(", ") || "New tags"}
            value={newTagsText}
          />
        </div>

        <div className="mt-auto grid gap-3">
          <button
            className="h-11 rounded-md border border-[#9fb1a8] bg-white px-3 text-sm font-semibold text-[#2f4a3d] disabled:text-[#87938e]"
            disabled={busyAction === "generate"}
            onClick={onRegenerate}
            type="button"
          >
            {busyAction === "generate" ? "Regenerating..." : "Regenerate"}
          </button>
          <button
            className="h-11 rounded-md border border-[#4d7466] bg-white px-3 text-sm font-semibold text-[#315d4a] disabled:border-[#c2c9c5] disabled:text-[#8b9891]"
            disabled={Boolean(busyAction) || wordpressBlocked}
            onClick={() => onPublish("draft")}
            type="button"
          >
            {busyAction === "draft" ? "Saving..." : "Save Draft"}
          </button>
          <button
            className="h-11 rounded-md bg-[#244658] px-3 text-sm font-semibold text-white disabled:bg-[#8b9891]"
            disabled={Boolean(busyAction) || wordpressBlocked}
            onClick={() => onPublish("publish")}
            type="button"
          >
            {busyAction === "publish" ? "Publishing..." : "Publish"}
          </button>
        </div>
      </aside>
    </section>
  );
}

function SuccessScreen({
  result,
  onCreateAnother,
}: {
  result: PublishResponse;
  onCreateAnother: () => void;
}) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 py-8">
      <div className="rounded-lg border border-[#d5ddd6] bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase text-[#5c6b63]">
          WordPress
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[#15251f]">
          Signal {result.status === "publish" ? "published" : "saved"}
        </h2>
        <div className="mt-5 grid gap-3">
          <a
            className="h-11 rounded-md bg-[#244658] px-3 py-3 text-center text-sm font-semibold text-white"
            href={result.link}
            rel="noreferrer"
            target="_blank"
          >
            View post
          </a>
          {result.editLink && (
            <a
              className="h-11 rounded-md border border-[#9fb1a8] bg-white px-3 py-3 text-center text-sm font-semibold text-[#2f4a3d]"
              href={result.editLink}
              rel="noreferrer"
              target="_blank"
            >
              Edit in WordPress
            </a>
          )}
          <button
            className="h-11 rounded-md border border-[#9fb1a8] bg-white px-3 text-sm font-semibold text-[#2f4a3d]"
            onClick={onCreateAnother}
            type="button"
          >
            Create another Signal
          </button>
        </div>
      </div>
    </section>
  );
}
