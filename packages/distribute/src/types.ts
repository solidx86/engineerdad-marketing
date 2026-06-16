export interface PostingPackAdset {
  cellId: string;
  name: string;
  dailyBudgetCents: number;
  dailyBudgetMyr: number;
  optimizationGoal: string;
  billingEvent: string;
  bidStrategy: string;
  targeting: { countries: string[]; ageMin: number; ageMax: number; locales: number[] };
}

export interface PostingPackAdCopy {
  primaryText: string;
  headline: string;
  description: string;
}

export interface PostingPackAd {
  variantId: string;
  rowId: string;
  title: string;
  cellId: string;
  adsetName: string;
  asset: { urls: string[]; format: string; aspect: string | null };
  en: PostingPackAdCopy;
  bm: PostingPackAdCopy;
  ctaType: string;
  backfill: { adIdEn: string | null; adIdMs: string | null; done: boolean };
}

export interface PostingPackSpec {
  runId: string;
  campaign: { name: string; objective: string; specialAdCategories: string[] };
  adsets: PostingPackAdset[];
  ads: PostingPackAd[];
}

export interface BackfillInput {
  rowId: string;
  adIdEn: string | null;
  adIdMs: string | null;
}
