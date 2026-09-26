import type { ContentItem, Profile, Topic } from './types';

export const defaultProfile: Profile = {
  goal: 'Build a personalized content ranking engine with Jev and an AI agent harness for language learning.',
  knownConcepts: ['React component hierarchy', 'single source of truth', 'controlled inputs'],
  interests: { agents: 0.8, ranking: 0.85, rl: 0.65, web: 0.55, language: 0.75, design: 0.45 },
  feedbackCount: 0,
  version: 1,
};

interface Brief {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: ContentItem['kind'];
  text: string;
  summary: string;
  concepts: string[];
  topics: Topic[];
}

// Original editorial study briefs, with primary source URLs verified 2026-09-26.
// They are neither verbatim source-page extracts nor saved outputs from a live model.
const briefs: Brief[] = [
  {
    id: 'jev-decisions', title: 'Jev: turn a reader profile into explicit decisions',
    publisher: 'TypeSafe AI · editorial brief', url: 'https://docs.typesafe.ai/models', kind: 'documentation',
    topics: ['ranking', 'agents'], concepts: ['atomic decision criteria', 'profile-conditioned forecasts', 'versioned model thresholds'],
    text: 'TypeSafe documents Jev as a text-input model for typed decisions. The same weights serve customers; customization happens through supplied state and question criteria, rather than customer-specific fine-tuning. For ValueRank, the engineering opportunity is to provide an explicit reader goal, known concepts, and an article brief, then ask separate questions about relevance, novelty, and actionability. The product must still choose how these forecasts affect ranking. A high relevance forecast does not establish that a summary is factually correct. Record the resolved model version and reader-profile version so later changes do not silently reuse old judgments.',
    summary: 'Use reader state and atomic criteria to obtain Jev forecasts. Keep model versioning and the utility policy explicit; this does not fine-tune Jev.',
  },
  {
    id: 'agent-harness', title: 'Build the harness before adding more autonomy',
    publisher: 'Anthropic · editorial brief', url: 'https://www.anthropic.com/engineering/building-effective-agents', kind: 'article',
    topics: ['agents'], concepts: ['bounded agent workflow', 'tool contracts', 'programmatic evidence gates'],
    text: 'Anthropic distinguishes workflows with predefined code paths from agents that dynamically choose their next actions. That distinction is useful for a curation engine: source extraction, structured analysis, evidence checking, and ranking form a small, inspectable workflow. Start with those stages and record failures at each boundary. The LLM can identify concepts and draft a concise explanation, while deterministic code checks schemas and exact supporting text. Only introduce open-ended tool selection when a measured failure requires it. For ValueRank, a bounded workflow makes it possible to replay one bad recommendation and locate the stage responsible.',
    summary: 'An inspectable source → analysis → evidence → ranking workflow is a practical first harness. Expand autonomy only when the task requires it.',
  },
  {
    id: 'context-engineering', title: 'A reader profile is a context budget',
    publisher: 'Anthropic · editorial brief', url: 'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents', kind: 'article',
    topics: ['agents', 'ranking'], concepts: ['context selection', 'memory compaction', 'retrieval scope'],
    text: 'Context engineering treats the information passed to a model as a resource that must be selected and maintained. A long interaction history is not automatically a useful profile. A ValueRank request can instead include the current goal, a compact set of explicitly known concepts, recent preference signals, and the candidate content. Preserve the underlying events so the compact profile can be revised rather than treated as permanent truth. Keep source evidence separate from instructions. This editorial application of context engineering suggests testing whether a smaller, relevant profile gives more consistent judgments than passing every historical click.',
    summary: 'Select compact reader context for each decision while retaining the events behind it. More stored history does not necessarily improve a prompt.',
  },
  {
    id: 'calibration', title: 'A score of 0.8 needs an event you can test',
    publisher: 'Guo et al. · editorial brief', url: 'https://arxiv.org/abs/1706.04599', kind: 'paper',
    topics: ['rl', 'ranking'], concepts: ['probability calibration', 'temperature scaling', 'reliability diagrams'],
    text: 'Guo and colleagues study whether model confidence matches observed correctness and evaluate post-processing methods including temperature scaling. This is a different question from whether a classifier is accurate or a feed feels useful. In ValueRank, define the event before evaluating a forecast: for example, whether a reader explicitly reports a piece useful under a stated goal. Retain held-out outcomes, inspect reliability bins, and check whether results differ across content types. A weighted combination of relevance, novelty, preference, and reading cost is a product utility score; it should not be displayed as a calibrated probability of value.',
    summary: 'Evaluate forecasts against a defined outcome and held-out data. A composite ranking score is a utility policy, not a probability.',
  },
  {
    id: 'contextual-bandits', title: 'Learning what to show without learning only clicks',
    publisher: 'Li et al. · editorial brief', url: 'https://arxiv.org/abs/1003.0146', kind: 'paper',
    topics: ['ranking', 'rl'], concepts: ['contextual bandit exploration', 'logged action propensities', 'partial feedback'],
    text: 'The contextual-bandit formulation chooses an item using contextual information and then observes feedback for the chosen action. Li and colleagues apply this approach to personalized news recommendation. For a future ValueRank experiment, this highlights a limitation of an ordinary feedback log: items never shown cannot receive ratings. Exploration and exposure records are therefore part of the data design, not just the ranking algorithm. A first prototype can use explicit useful, known, and not-useful signals without claiming to run a bandit. Before adding one, specify the reward and decide how to measure learning value beyond attention.',
    summary: 'Exposure affects the feedback you can observe. Bandit experiments need an explicit reward and action logging; this prototype uses a simpler preference update.',
  },
  {
    id: 'rlhf', title: 'Human preference is a training signal, not a truth label',
    publisher: 'Ouyang et al. · editorial brief', url: 'https://arxiv.org/abs/2203.02155', kind: 'paper',
    topics: ['rl', 'agents'], concepts: ['RLHF reward modeling', 'pairwise preference labels', 'supervised instruction tuning'],
    text: 'InstructGPT combines demonstration-based supervised training with rankings of model outputs and reinforcement learning from human feedback. For a founder building ValueRank, the transferable lesson is to distinguish data types before selecting a training method. A reader preference between two explanations is different from a factual label about an article, and neither establishes that a concept has been mastered. Save the prompt context, candidate alternatives, and decision when collecting comparisons. This prototype updates a transparent profile from explicit feedback; it does not train model weights. A future learning system would need evaluation data and a clearly specified objective.',
    summary: 'Store preferences with their context and distinguish them from correctness or mastery. Profile updates in this demo are not RLHF training.',
  },
  {
    id: 'react-state', title: 'Keep the ranking UI derived from one state',
    publisher: 'React · editorial brief', url: 'https://react.dev/learn/thinking-in-react', kind: 'documentation',
    topics: ['web', 'design'], concepts: ['React component hierarchy', 'single source of truth', 'controlled inputs'],
    text: 'Thinking in React develops an interface by identifying a component hierarchy, building a static version, and then choosing the minimal state needed for interaction. For ValueRank, the ranked feed, selected item, and profile inspector should agree about the same underlying data. Avoid storing separate copies of a score in each card when it can be derived from a shared ranking result. Treat goal edits and feedback as explicit state transitions. The resulting interface becomes easier to test: one useful action should update the profile, recompute the feed, and explain the new order consistently.',
    summary: 'Derive the feed and its explanations from shared state. Component boundaries should make feedback transitions easy to reason about.',
  },
  {
    id: 'next-boundaries', title: 'Keep model calls behind the server boundary',
    publisher: 'Next.js · editorial brief', url: 'https://nextjs.org/docs/app/getting-started/server-and-client-components', kind: 'documentation',
    topics: ['web', 'agents'], concepts: ['server component boundaries', 'client interaction state', 'server-only secrets'],
    text: 'Next.js separates server-rendered components from client components that need state, event handlers, or browser APIs. That boundary offers a useful design exercise for an AI application even when its prototype uses a different server. Keep provider credentials and model requests in server-side code. Send the browser only the data needed to render the feed and accept feedback. Interactive ranking controls can remain client-side while the server validates inputs and persists events. For ValueRank, the critical property is an auditable boundary: the browser should never receive the secret needed to call a paid model provider.',
    summary: 'Separate interactive controls from server-owned secrets and model calls. Next.js component boundaries provide one concrete implementation pattern.',
  },
  {
    id: 'retrieval-practice', title: 'Reading value should include what survives tomorrow',
    publisher: 'Roediger & Karpicke · editorial brief', url: 'https://pubmed.ncbi.nlm.nih.gov/16507066/', kind: 'paper',
    topics: ['language', 'ranking'], concepts: ['retrieval practice', 'delayed retention assessment', 'recognition versus recall'],
    text: 'Roediger and Karpicke report experiments showing that testing studied material can improve later retention. Applying this to a language-learning product requires an additional product hypothesis: the most engaging article today may not produce the most useful recall later. ValueRank could attach a brief retrieval prompt to an item and observe a delayed answer, alongside the reader’s immediate usefulness rating. These are distinct signals and should be stored separately. Do not mark every concept mastered merely because an article was liked. A useful first experiment compares immediate preference with later recall under a fixed learning goal.',
    summary: 'Pair immediate usefulness with a later recall check. A preference signal alone is insufficient evidence that the reader learned a concept.',
  },
];

export const seedItems: ContentItem[] = briefs.map(brief => ({
  id: brief.id, title: brief.title, publisher: brief.publisher, url: brief.url, kind: brief.kind,
  text: brief.text, addedAt: '2026-09-26T00:00:00.000Z', provenance: 'editorial-brief',
  analysis: {
    summary: brief.summary, concepts: brief.concepts, topics: brief.topics,
    // Quotes are verified substrings of our own editorial text, not quotations from the linked page.
    evidence: [{ quote: brief.text.split(/(?<=\.)\s+/)[0], insight: 'Supporting sentence from the original editorial brief.' }],
    readingMinutes: 1, source: 'editorial', model: 'editorial-v1',
  },
  decision: null, feedback: null, status: 'ready', error: null,
}));
