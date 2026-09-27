export type FeedbackKind = 'useful' | 'known' | 'not_useful';
export type Topic = 'agents' | 'ranking' | 'rl' | 'web' | 'language' | 'design';
export const TOPICS: Topic[] = ['agents', 'ranking', 'rl', 'web', 'language', 'design'];
export interface Profile {
  goal: string;
  knownConcepts: string[];
  interests: Record<Topic, number>;
  feedbackCount: number;
  version: number;
}
export interface Evidence { quote: string; insight: string }
export interface Analysis {
  summary: string;
  concepts: string[];
  topics: Topic[];
  evidence: Evidence[];
  readingMinutes: number;
  source: 'llm' | 'editorial';
  model: string;
}
export interface Decision {
  relevance: number;
  novelty: number;
  actionability: number;
  source: 'jev';
  provider?: 'typesafe' | 'openrouter';
  model: string;
  profileVersion: number;
  createdAt: string;
}
export interface ContentItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  kind: 'article' | 'paper' | 'documentation' | 'note';
  text: string;
  addedAt: string;
  provenance: 'editorial-brief' | 'user-paste' | 'url-extraction';
  analysis: Analysis | null;
  decision: Decision | null;
  feedback: FeedbackKind | null;
  status: 'unprocessed' | 'processing' | 'ready' | 'error';
  error: string | null;
}
export interface RankBreakdown {
  relevance: number;
  novelty: number;
  actionability: number;
  preference: number;
  knowledgeOverlap: number;
  timeCost: number;
  knownPenalty: number;
}
export interface RankedItem extends ContentItem {
  score: number;
  baselineScore: number;
  rank: number;
  previousRank?: number;
  scoreSource: 'jev-personalized' | 'local-baseline' | 'stale-jev';
  breakdown: RankBreakdown;
  reason: string;
  newConcepts: string[];
  knownConcepts: string[];
}
export interface FeedbackEvent {
  id: string;
  itemId: string;
  kind: FeedbackKind;
  createdAt: string;
  goal: string;
  profileVersion: number;
  profileSnapshot?: Pick<Profile, 'goal' | 'knownConcepts' | 'interests'>;
  concepts: string[];
  topics: Topic[];
}
export interface TraceEvent {
  id: string;
  stage: 'source' | 'llm' | 'evidence' | 'jev' | 'rank' | 'error';
  title: string;
  detail: string;
  itemId?: string;
  status: 'running' | 'completed' | 'failed';
  at: string;
  durationMs?: number;
  tokens?: number;
  model?: string;
}
export interface Run {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  processed: number;
  total: number;
  errors: number;
  events: TraceEvent[];
}
export interface ConnectionStatus {
  llm: boolean;
  jev: boolean;
  jevProvider: 'typesafe' | 'openrouter';
  llmModel: string;
  jevModel: string;
}
export interface AppState {
  profile: Profile;
  items: RankedItem[];
  feedback: FeedbackEvent[];
  run: Run | null;
  connections: ConnectionStatus;
}
