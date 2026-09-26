import type { ContentItem, Profile, Topic } from './types';

export const BURST_CONCURRENCY = 6;
export const BURST_MAX_ITEMS = 48;

export type BurstItemStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled' | 'skipped';
export interface BurstItem extends Omit<ContentItem, 'status'> {
  status: BurstItemStatus;
  topics: Topic[];
  readingMinutes: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  tokens: number;
  score: number | null;
}

export interface BurstJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  profile: Profile;
  provider: 'typesafe' | 'openrouter';
  model: string;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  total: number;
  processed: number;
  errors: number;
  cancelled: number;
  skipped: number;
  active: number;
  queued: number;
  forecasts: number;
  tokens: number;
  concurrency: number;
  throughputPerSecond: number;
  cancelRequested: boolean;
  stopReason: string | null;
  persistenceError: string | null;
  items: BurstItem[];
}
