export type SourceAccessStatus = "full" | "partial" | "metadata_only" | "manual";

export type PublishStatus = "draft" | "publish";

export interface TaxonomyTerm {
  id: number;
  name: string;
  slug: string;
  taxonomy: "category" | "post_tag";
  count?: number;
}

export interface ArticleData {
  url: string;
  title: string;
  description: string;
  siteName: string;
  byline?: string;
  publishedAt?: string;
  text: string;
  accessStatus: SourceAccessStatus;
  manualSummaryUsed: boolean;
  fetchError?: string;
}

export interface SignalDraft {
  title: string;
  signal: string;
  excerpt: string;
  sourceUrl: string;
  sourceSiteName?: string;
  sourceByline?: string;
  sourcePublishedAt?: string;
  sourceAccessStatus: SourceAccessStatus;
  suggestedCategory: string;
  suggestedTags: string[];
  additionalReferences: string[];
}

export interface DuplicateInfo {
  isDuplicate: boolean;
  firstSeenAt?: string;
  generateCount?: number;
}

export interface GenerateSignalRequest {
  url: string;
  observation: string;
  manualSummary?: string;
  selectedCategory?: string;
  selectedTags?: string[];
}

export interface GenerateSignalResponse {
  article: ArticleData;
  draft: SignalDraft;
  duplicate: DuplicateInfo;
  storageWarning?: string;
}

export interface PublishRequest {
  draft: SignalDraft;
  categoryId?: number;
  tagIds: number[];
  status: PublishStatus;
}

export interface PublishResponse {
  id: number;
  link: string;
  editLink?: string;
  status: PublishStatus;
}
