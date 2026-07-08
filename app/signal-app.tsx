"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  buildSignalPostContent,
  formatSourceCredit,
  parseAdditionalReferencesInput,
} from "@/lib/post-content";
import type {
  ArticleData,
  GenerateSignalResponse,
  PublishResponse,
  PublishStatus,
  SignalDraft,
  TaxonomyTerm,
} from "@/lib/types";

type Screen = "submit" | "preview" | "confirm" | "success";

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
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTermName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findTermByName(terms: TaxonomyTerm[], name: string) {
  const normalized = normalizeTermName(name);
  if (!normalized) {
    return null;
  }
  return terms.find((term) => normalizeTermName(term.name) === normalized) ?? null;
}

function uniqueIds(values: number[]) {
  return [...new Set(values)];
}

function uniqueNames(values: string[]) {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const name = value.trim();
    const key = normalizeTermName(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }

  return names;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function isLocalDevHost() {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    window.location.hostname
  );
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
  const [categoryNameText, setCategoryNameText] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [typedTagsText, setTypedTagsText] = useState("");
  const [additionalReferencesText, setAdditionalReferencesText] = useState("");
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [draft, setDraft] = useState<SignalDraft | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [success, setSuccess] = useState<PublishResponse | null>(null);
  const [pendingStatus, setPendingStatus] = useState<PublishStatus | null>(null);

  const categoryName = categoryNameText.trim();
  const matchedCategory = useMemo(
    () => findTermByName(taxonomy.categories, categoryName),
    [categoryName, taxonomy.categories]
  );
  const skippedCategoryNames = useMemo(
    () => (categoryName && !matchedCategory ? [categoryName] : []),
    [categoryName, matchedCategory]
  );
  const selectedCategoryName = matchedCategory?.name ?? "";
  const selectedCategoryId = matchedCategory?.id;
  const typedTagNames = useMemo(() => uniqueNames(splitTags(typedTagsText)), [
    typedTagsText,
  ]);
  const matchedTypedTags = useMemo(
    () =>
      typedTagNames
        .map((tagName) => findTermByName(taxonomy.tags, tagName))
        .filter((tag): tag is TaxonomyTerm => Boolean(tag)),
    [taxonomy.tags, typedTagNames]
  );
  const skippedTagNames = useMemo(
    () =>
      typedTagNames.filter(
        (tagName) => !findTermByName(taxonomy.tags, tagName)
      ),
    [taxonomy.tags, typedTagNames]
  );
  const publishTagIds = useMemo(
    () => uniqueIds([...selectedTagIds, ...matchedTypedTags.map((tag) => tag.id)]),
    [matchedTypedTags, selectedTagIds]
  );
  const selectedTagNames = useMemo(
    () =>
      taxonomy.tags
        .filter((tag) => publishTagIds.includes(tag.id))
        .map((tag) => tag.name),
    [publishTagIds, taxonomy.tags]
  );
  const generationTagNames = useMemo(
    () => uniqueNames([...selectedTagNames, ...typedTagNames]),
    [selectedTagNames, typedTagNames]
  );
  const taxonomyWarning = useMemo(() => {
    const messages: string[] = [];
    if (skippedCategoryNames.length) {
      messages.push(
        `This category does not exist yet. Choose an existing one or create it deliberately. Skipped: ${skippedCategoryNames.join(", ")}.`
      );
    }
    if (skippedTagNames.length) {
      messages.push(
        `This tag does not exist yet. Choose an existing one or create it deliberately. Skipped: ${skippedTagNames.join(", ")}.`
      );
    }
    return messages.join(" ");
  }, [skippedCategoryNames, skippedTagNames]);
  const additionalReferencesValidation = useMemo(
    () =>
      parseAdditionalReferencesInput(
        additionalReferencesText,
        draft?.sourceUrl || articleUrl
      ),
    [additionalReferencesText, articleUrl, draft?.sourceUrl]
  );
  const invalidAdditionalReferences = additionalReferencesValidation.invalid;

  const wordpressBlocked =
    draft?.sourceAccessStatus === "metadata_only" && !manualSummary.trim();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (isLocalDevHost()) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) =>
                registration.scope.startsWith(window.location.origin)
              )
              .map((registration) => registration.unregister())
          )
        )
        .catch(() => undefined);

      if ("caches" in window) {
        window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("ai-signal-pwa"))
                .map((key) => window.caches.delete(key))
            )
          )
          .catch(() => undefined);
      }
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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
    const text = await response.text();
    let body: { error?: string; details?: string } | T | null = null;

    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        throw new Error(
          `Expected JSON from ${path}, but received non-JSON response. HTTP ${response.status}. ${previewText(text)}`
        );
      }
    }

    if (!response.ok) {
      const errorBody = body as { error?: string; details?: string } | null;
      const detail = errorBody?.details ? ` ${errorBody.details}` : "";
      throw new Error(
        errorBody?.error
          ? `${errorBody.error}${detail}`
          : `Request to ${path} failed with HTTP ${response.status}.`
      );
    }

    if (!body) {
      throw new Error(`Expected JSON from ${path}, but response was empty.`);
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
          selectedCategory: categoryName || undefined,
          selectedTags: generationTagNames,
        }),
      });

      setArticle(response.article);
      setDraft({
        ...response.draft,
        additionalReferences: parseAdditionalReferencesInput(
          additionalReferencesText,
          response.draft.sourceUrl
        ).urls,
      });
      setPendingStatus(null);
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

  function updateAdditionalReferences(value: string) {
    setAdditionalReferencesText(value);
    setDraft((current) =>
      current
        ? {
            ...current,
            additionalReferences: parseAdditionalReferencesInput(
              value,
              current.sourceUrl
            ).urls,
          }
        : current
    );
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    );
  }

  function reviewWordPressAction(status: PublishStatus) {
    if (!draft) {
      return;
    }

    if (wordpressBlocked) {
      setErrorMessage(
        "Add a manual summary or use a readable URL before sending this Signal to WordPress."
      );
      return;
    }

    if (invalidAdditionalReferences.length) {
      setErrorMessage(
        `Fix or remove invalid additional reference URLs before sending this Signal to WordPress: ${invalidAdditionalReferences.join(", ")}.`
      );
      return;
    }

    setPendingStatus(status);
    setErrorMessage("");
    setStatusMessage(
      taxonomyWarning
        ? `Unmatched taxonomy terms will be skipped. ${taxonomyWarning}`
        : ""
    );
    setScreen("confirm");
  }

  async function sendToWordPress() {
    if (!draft || !pendingStatus) {
      return;
    }

    setBusyAction(pendingStatus);
    setErrorMessage("");
    setStatusMessage("");

    try {
      const references = parseAdditionalReferencesInput(
        additionalReferencesText,
        draft.sourceUrl
      );
      if (references.invalid.length) {
        throw new Error(
          `Fix or remove invalid additional reference URLs before sending this Signal to WordPress: ${references.invalid.join(", ")}.`
        );
      }

      const result = await apiFetch<PublishResponse>("/api/publish", {
        method: "POST",
        body: JSON.stringify({
          draft: {
            ...draft,
            additionalReferences: references.urls,
          },
          categoryId: selectedCategoryId,
          tagIds: publishTagIds,
          status: pendingStatus,
        }),
      });

      setSuccess(result);
      setPendingStatus(null);
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
    setCategoryNameText("");
    setSelectedTagIds([]);
    setTypedTagsText("");
    setAdditionalReferencesText("");
    setArticle(null);
    setDraft(null);
    setPendingStatus(null);
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
            additionalReferencesText={additionalReferencesText}
            articleUrl={articleUrl}
            authToken={authToken}
            busy={busyAction === "generate"}
            categoryNameText={categoryNameText}
            invalidAdditionalReferences={invalidAdditionalReferences}
            manualSummary={manualSummary}
            observation={observation}
            selectedTagIds={selectedTagIds}
            typedTagsText={typedTagsText}
            taxonomyWarning={taxonomyWarning}
            setArticleUrl={setArticleUrl}
            setAuthToken={setAuthToken}
            setCategoryNameText={setCategoryNameText}
            setAdditionalReferencesText={updateAdditionalReferences}
            setManualSummary={setManualSummary}
            setObservation={setObservation}
            setTypedTagsText={setTypedTagsText}
            taxonomy={taxonomy}
            toggleTag={toggleTag}
            onGenerate={generateSignal}
            onReloadTaxonomy={loadTaxonomy}
          />
        )}

        {screen === "preview" && draft && (
          <PreviewScreen
            additionalReferencesText={additionalReferencesText}
            article={article}
            busyAction={busyAction}
            categoryNameText={categoryNameText}
            draft={draft}
            invalidAdditionalReferences={invalidAdditionalReferences}
            selectedTagIds={selectedTagIds}
            setAdditionalReferencesText={updateAdditionalReferences}
            setCategoryNameText={setCategoryNameText}
            setTypedTagsText={setTypedTagsText}
            taxonomyWarning={taxonomyWarning}
            taxonomy={taxonomy}
            toggleTag={toggleTag}
            typedTagsText={typedTagsText}
            updateDraft={updateDraft}
            wordpressBlocked={wordpressBlocked}
            onBack={() => setScreen("submit")}
            onPublish={reviewWordPressAction}
            onRegenerate={() => generateSignal()}
          />
        )}

        {screen === "confirm" && draft && pendingStatus && (
          <ConfirmScreen
            article={article}
            busyAction={busyAction}
            invalidAdditionalReferences={invalidAdditionalReferences}
            categoryName={selectedCategoryName}
            draft={draft}
            pendingStatus={pendingStatus}
            skippedCategoryNames={skippedCategoryNames}
            skippedTagNames={skippedTagNames}
            tagNames={selectedTagNames}
            onBack={() => setScreen("preview")}
            onSend={sendToWordPress}
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
  additionalReferencesText,
  articleUrl,
  authToken,
  busy,
  categoryNameText,
  invalidAdditionalReferences,
  manualSummary,
  observation,
  selectedTagIds,
  taxonomyWarning,
  typedTagsText,
  setArticleUrl,
  setAdditionalReferencesText,
  setAuthToken,
  setCategoryNameText,
  setManualSummary,
  setObservation,
  setTypedTagsText,
  taxonomy,
  toggleTag,
  onGenerate,
  onReloadTaxonomy,
}: {
  additionalReferencesText: string;
  articleUrl: string;
  authToken: string;
  busy: boolean;
  categoryNameText: string;
  invalidAdditionalReferences: string[];
  manualSummary: string;
  observation: string;
  selectedTagIds: number[];
  taxonomyWarning: string;
  typedTagsText: string;
  setArticleUrl: (value: string) => void;
  setAdditionalReferencesText: (value: string) => void;
  setAuthToken: (value: string) => void;
  setCategoryNameText: (value: string) => void;
  setManualSummary: (value: string) => void;
  setObservation: (value: string) => void;
  setTypedTagsText: (value: string) => void;
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

        <label className="space-y-2">
          <FieldLabel>Additional references</FieldLabel>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none transition focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setAdditionalReferencesText(event.target.value)}
            placeholder="https://example.com/further-reading"
            value={additionalReferencesText}
          />
          <p className="text-sm text-[#66746c]">Optional. One URL per line.</p>
          {invalidAdditionalReferences.length > 0 && (
            <p className="text-sm leading-6 text-[#9a4b1f]">
              Invalid URL{invalidAdditionalReferences.length === 1 ? "" : "s"}:{" "}
              {invalidAdditionalReferences.join(", ")}
            </p>
          )}
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
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            list="submit-category-options"
            onChange={(event) => setCategoryNameText(event.target.value)}
            placeholder="Type an existing category"
            value={categoryNameText}
          />
          <datalist id="submit-category-options">
            {taxonomy.categories.map((category) => (
              <option key={category.id} value={category.name} />
            ))}
          </datalist>
          <p className="text-sm text-[#66746c]">
            Existing WordPress categories only.
          </p>
          {taxonomy.loading && (
            <p className="text-sm text-[#66746c]">Loading categories...</p>
          )}
          {taxonomy.error && (
            <p className="text-sm leading-6 text-[#9a4b1f]">{taxonomy.error}</p>
          )}
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
            onChange={(event) => setTypedTagsText(event.target.value)}
            placeholder="Type existing tags, comma separated"
            value={typedTagsText}
          />
        </div>

        {taxonomyWarning && (
          <div className="rounded-md border border-[#d7c98d] bg-[#fff9db] px-3 py-2 text-sm leading-6 text-[#5f5012]">
            {taxonomyWarning}
          </div>
        )}
      </aside>
    </form>
  );
}

function PreviewScreen({
  additionalReferencesText,
  article,
  busyAction,
  categoryNameText,
  draft,
  invalidAdditionalReferences,
  selectedTagIds,
  setAdditionalReferencesText,
  setCategoryNameText,
  setTypedTagsText,
  taxonomyWarning,
  taxonomy,
  toggleTag,
  typedTagsText,
  updateDraft,
  wordpressBlocked,
  onBack,
  onPublish,
  onRegenerate,
}: {
  additionalReferencesText: string;
  article: ArticleData | null;
  busyAction: string;
  categoryNameText: string;
  draft: SignalDraft;
  invalidAdditionalReferences: string[];
  selectedTagIds: number[];
  setAdditionalReferencesText: (value: string) => void;
  setCategoryNameText: (value: string) => void;
  setTypedTagsText: (value: string) => void;
  taxonomyWarning: string;
  taxonomy: TaxonomyState;
  toggleTag: (tagId: number) => void;
  typedTagsText: string;
  updateDraft: <K extends keyof SignalDraft>(key: K, value: SignalDraft[K]) => void;
  wordpressBlocked: boolean;
  onBack: () => void;
  onPublish: (status: PublishStatus) => void;
  onRegenerate: () => void;
}) {
  const sourceCredit = formatSourceCredit(draft);

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

        {sourceCredit && (
          <p className="text-sm leading-6 text-[#5c6b63]">{sourceCredit}</p>
        )}
        <a
          className="break-all text-sm font-medium text-[#2f6275]"
          href={draft.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {draft.sourceUrl}
        </a>

        <div className="space-y-2">
          <FieldLabel>Further reading</FieldLabel>
          {draft.additionalReferences.length ? (
            <ul className="grid gap-2 text-sm leading-6 text-[#40564b]">
              {draft.additionalReferences.map((url) => (
                <li className="break-all" key={url}>
                  {url}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#66746c]">None</p>
          )}
        </div>

        <label className="space-y-2">
          <FieldLabel>Additional references</FieldLabel>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            onChange={(event) => setAdditionalReferencesText(event.target.value)}
            placeholder="https://example.com/further-reading"
            value={additionalReferencesText}
          />
          <p className="text-sm text-[#66746c]">Optional. One URL per line.</p>
          {invalidAdditionalReferences.length > 0 && (
            <p className="text-sm leading-6 text-[#9a4b1f]">
              Invalid URL{invalidAdditionalReferences.length === 1 ? "" : "s"}:{" "}
              {invalidAdditionalReferences.join(", ")}
            </p>
          )}
        </label>
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
          <input
            className="h-11 w-full rounded-md border border-[#c4cec6] bg-white px-3 text-base outline-none focus:border-[#2f6275] focus:ring-2 focus:ring-[#c9e2eb]"
            list="preview-category-options"
            onChange={(event) => setCategoryNameText(event.target.value)}
            placeholder={draft.suggestedCategory || "Type an existing category"}
            value={categoryNameText}
          />
          <datalist id="preview-category-options">
            {taxonomy.categories.map((category) => (
              <option key={category.id} value={category.name} />
            ))}
          </datalist>
          <p className="text-sm text-[#66746c]">
            Existing WordPress categories only.
          </p>
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
            onChange={(event) => setTypedTagsText(event.target.value)}
            placeholder={draft.suggestedTags.join(", ") || "Type existing tags"}
            value={typedTagsText}
          />
        </div>

        {taxonomyWarning && (
          <div className="rounded-md border border-[#d7c98d] bg-[#fff9db] px-3 py-2 text-sm leading-6 text-[#5f5012]">
            {taxonomyWarning}
          </div>
        )}

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
            disabled={
              Boolean(busyAction) ||
              wordpressBlocked ||
              invalidAdditionalReferences.length > 0
            }
            onClick={() => onPublish("draft")}
            type="button"
          >
            Review Draft
          </button>
          <button
            className="h-11 rounded-md bg-[#244658] px-3 text-sm font-semibold text-white disabled:bg-[#8b9891]"
            disabled={
              Boolean(busyAction) ||
              wordpressBlocked ||
              invalidAdditionalReferences.length > 0
            }
            onClick={() => onPublish("publish")}
            type="button"
          >
            Review Publish
          </button>
        </div>
      </aside>
    </section>
  );
}

function ConfirmScreen({
  article,
  busyAction,
  categoryName,
  draft,
  invalidAdditionalReferences,
  pendingStatus,
  skippedCategoryNames,
  skippedTagNames,
  tagNames,
  onBack,
  onSend,
}: {
  article: ArticleData | null;
  busyAction: string;
  categoryName: string;
  draft: SignalDraft;
  invalidAdditionalReferences: string[];
  pendingStatus: PublishStatus;
  skippedCategoryNames: string[];
  skippedTagNames: string[];
  tagNames: string[];
  onBack: () => void;
  onSend: () => void;
}) {
  const contentHtml = buildSignalPostContent(draft);
  const isBusy = busyAction === pendingStatus;
  const hasSkippedTerms = skippedCategoryNames.length || skippedTagNames.length;
  const sourceCredit = formatSourceCredit(draft);

  return (
    <section className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
      <div className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-[#5c6b63]">
              Confirm
            </p>
            <h2 className="text-xl font-semibold text-[#15251f]">
              {pendingStatus === "publish" ? "Publish Signal" : "Save Draft"}
            </h2>
          </div>
          <span className="rounded-md bg-[#fff9db] px-3 py-1 text-xs font-semibold text-[#5f5012]">
            no request sent
          </span>
        </div>

        <article className="rounded-md border border-[#d5ddd6] bg-[#fbfcfb] p-4">
          <p className="text-xs font-semibold uppercase text-[#5c6b63]">
            Public post
          </p>
          <h3 className="mt-2 text-2xl font-semibold leading-8 text-[#15251f]">
            {draft.title}
          </h3>
          <div
            className="mt-4 space-y-4 text-base leading-7 text-[#26332d] [&_a]:font-semibold [&_a]:text-[#2f6275]"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        </article>

        <label className="space-y-2">
          <FieldLabel>Excerpt</FieldLabel>
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 text-base outline-none"
            readOnly
            value={draft.excerpt}
          />
        </label>

        <label className="space-y-2">
          <FieldLabel>WordPress content HTML</FieldLabel>
          <textarea
            className="min-h-36 w-full resize-y rounded-md border border-[#c4cec6] bg-[#fbfcfb] px-3 py-3 font-mono text-sm leading-6 outline-none"
            readOnly
            value={contentHtml}
          />
        </label>
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-[#d5ddd6] bg-[#fcfdfb] p-4 shadow-sm">
        <div className="grid gap-3 text-sm">
          <div className="rounded-md border border-[#d5ddd6] bg-white p-3">
            <p className="font-semibold text-[#26332d]">Status</p>
            <p className="mt-1 capitalize text-[#5c6b63]">{pendingStatus}</p>
          </div>
          <div className="rounded-md border border-[#d5ddd6] bg-white p-3">
            <p className="font-semibold text-[#26332d]">Category</p>
            <p className="mt-1 text-[#5c6b63]">{categoryName || "None"}</p>
          </div>
          <div className="rounded-md border border-[#d5ddd6] bg-white p-3">
            <p className="font-semibold text-[#26332d]">Tags</p>
            <p className="mt-1 text-[#5c6b63]">
              {tagNames.length ? tagNames.join(", ") : "None"}
            </p>
          </div>
          {hasSkippedTerms ? (
            <div className="rounded-md border border-[#d7c98d] bg-[#fff9db] p-3">
              <p className="font-semibold text-[#5f5012]">Skipped taxonomy</p>
              {skippedCategoryNames.length > 0 && (
                <p className="mt-1 text-[#5f5012]">
                  Categories: {skippedCategoryNames.join(", ")}
                </p>
              )}
              {skippedTagNames.length > 0 && (
                <p className="mt-1 text-[#5f5012]">
                  Tags: {skippedTagNames.join(", ")}
                </p>
              )}
            </div>
          ) : null}
          {invalidAdditionalReferences.length > 0 && (
            <div className="rounded-md border border-[#e0b29b] bg-[#fff4ed] p-3">
              <p className="font-semibold text-[#763818]">Invalid references</p>
              <p className="mt-1 break-words text-[#763818]">
                {invalidAdditionalReferences.join(", ")}
              </p>
            </div>
          )}
          <div className="rounded-md border border-[#d5ddd6] bg-white p-3">
            <p className="font-semibold text-[#26332d]">Source Access</p>
            <p className="mt-1 text-[#5c6b63]">
              {accessLabels[draft.sourceAccessStatus]}
            </p>
          </div>
          <div className="rounded-md border border-[#d5ddd6] bg-white p-3">
            <p className="font-semibold text-[#26332d]">Source</p>
            <p className="mt-1 break-words text-[#5c6b63]">
              {sourceCredit || article?.title || "Source"}
            </p>
            <a
              className="mt-1 block break-all font-semibold text-[#2f6275]"
              href={draft.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {draft.sourceUrl}
            </a>
          </div>
        </div>

        <div className="mt-auto grid gap-3">
          <button
            className="h-11 rounded-md border border-[#9fb1a8] bg-white px-3 text-sm font-semibold text-[#2f4a3d]"
            disabled={Boolean(busyAction)}
            onClick={onBack}
            type="button"
          >
            Back to Edit
          </button>
          <button
            className="h-11 rounded-md bg-[#244658] px-3 text-sm font-semibold text-white disabled:bg-[#8b9891]"
            disabled={Boolean(busyAction) || invalidAdditionalReferences.length > 0}
            onClick={onSend}
            type="button"
          >
            {isBusy ? "Sending..." : "Send to WordPress"}
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
