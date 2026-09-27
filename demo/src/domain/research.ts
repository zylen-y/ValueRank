import type { PersonalContext, PersonalSource, PersonalUnit, SearchStatus } from './personal';

export interface ResearchProject {
  id: string;
  version: number;
  title: string;
  goal: string;
  constraints: string;
  createdAt: string;
  updatedAt: string;
  /** Research activity does not revise the frozen goal/constraints version. */
  lastActivityAt?: string;
}

export interface ResearchSave {
  id: string;
  projectId: string;
  sessionId: string;
  unit: PersonalUnit;
  sources: PersonalSource[];
  context: PersonalContext;
  note: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** Citation IDs refer to immutable saved-card snapshots, never their current rank. */
export interface ResearchStatement { text: string; evidenceIds: string[] }
export interface ResearchBriefContent {
  recommendation: ResearchStatement;
  reasons: ResearchStatement[];
  alternatives: { title: string; assessment: ResearchStatement }[];
  tradeoffs: ResearchStatement[];
  openQuestions: string[];
  nextSteps: string[];
}
export interface ResearchBriefSupportPassage {
  evidenceId: string;
  sourceId: string;
  sourceVersion: number;
  title: string;
  url: string;
  publisher: string;
  quote: string;
}
export interface ResearchBriefSupportCheck {
  id: string;
  section: 'recommendation' | 'reason' | 'alternative' | 'tradeoff' | 'open-question' | 'next-step';
  statement: string;
  evidenceIds: string[];
  passages: ResearchBriefSupportPassage[];
  status: 'pending' | 'passed' | 'needs-review' | 'unavailable';
  /** Fallible source-support estimate, not a truth probability or calibration claim. */
  score?: number;
  model?: string;
  error?: string;
  checkedAt?: string;
  tokens?: number;
}
export interface ResearchBriefSupportReview {
  version: string;
  threshold: number;
  question: string;
  scope: 'cited-statements' | 'all-generated-prose';
  status: 'checking' | 'passed' | 'needs-review';
  checks: ResearchBriefSupportCheck[];
}
export interface ResearchBrief {
  id: string;
  projectId: string;
  status: 'generating' | 'completed' | 'needs-review' | 'failed' | 'cancelled';
  project: ResearchProject;
  evidence: ResearchSave[];
  content?: ResearchBriefContent;
  /** Quarantined content is never an accepted result or a completed Markdown export. */
  draft?: ResearchBriefContent;
  /** Parsed generation retained even when citation validation rejects it. */
  candidate?: unknown;
  sourceSupport?: ResearchBriefSupportReview;
  model?: string;
  tokens?: number;
  durationMs?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ResearchProjectDetail {
  project: ResearchProject;
  saved: ResearchSave[];
  briefs: ResearchBrief[];
  sessionIds: string[];
  sessions: { id: string; query: string; status: SearchStatus; createdAt: string; unitCount: number }[];
}
