import { TOPICS, type ContentItem, type FeedbackKind, type Profile, type RankedItem, type Topic } from './types';

const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  agents: /\b(agent(?:s|ic)?|harness|context engineering|llm|tool use|workflow)\b|에이전트|하네스/gi,
  ranking: /\b(rank(?:ing|er)?|recommend(?:ation|er)?|personaliz\w*|jev|curation|bandit\w*|valuerank)\b|랭킹|추천|큐레이션/gi,
  rl: /\b(rl|rlhf|rlvr|rlcd|reinforcement|calibrat\w*|reward|policy gradient|ppo|dpo)\b|강화학습|보정/gi,
  web: /\b(react|next\.?js|next|vercel|frontend|front.end|web|server component\w*)\b|프론트엔드|웹/gi,
  language: /\b(language learning|learn(?:ing)? (?:a |the )?(?:language|english|korean)|vocabular\w*|spaced repetition|retrieval practice|second.language|english|linguistic\w*)\b|언어 학습|영어|외국어/gi,
  design: /\b(design|figma|framer|typograph\w*|layout|ux|ui)\b|디자인/gi,
};

const STOP_WORDS = new Set('a an and as at be build building by for from how i in into is it its learn learning my of on or our the this to use using with'.split(' '));
const BROAD_CONCEPTS = new Set([
  ...TOPICS, 'ai', 'artificial intelligence', 'machine learning', 'llm', 'llms', 'react', 'nextjs',
  'next.js', 'jev', 'design', 'reinforcement learning', 'rlhf', 'rlvr', 'rlcd', 'language learning',
  'agent', 'web development', 'programming', 'typescript', 'javascript', 'python', 'figma', 'framer',
]);

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const unit = (value: number, fallback = 0.5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const tokens = (text: string) => new Set(normalize(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !STOP_WORDS.has(word)));

function uniqueConcepts(concepts: string[]) {
  const seen = new Set<string>();
  return concepts.filter(concept => {
    const key = normalize(concept);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function topicsFor(item: ContentItem): Topic[] {
  const explicit = [...new Set(item.analysis?.topics ?? [])].filter(topic => TOPICS.includes(topic));
  if (explicit.length) return explicit;
  const text = `${item.title} ${item.text}`;
  return TOPICS.filter(topic => [...text.matchAll(TOPIC_PATTERNS[topic])].length > 0);
}

function goalRelevance(item: ContentItem, profile: Profile, topics: Topic[]): number {
  const goalWeights = TOPICS.map(topic => Math.min(2, [...profile.goal.matchAll(TOPIC_PATTERNS[topic])].length));
  const total = goalWeights.reduce((sum, value) => sum + value, 0);
  const topicMatch = total ? TOPICS.reduce((sum, topic, index) => sum + (topics.includes(topic) ? goalWeights[index] : 0), 0) / total : 0;
  const goalWords = tokens(profile.goal);
  const itemWords = tokens(`${item.title} ${item.analysis?.summary ?? item.text} ${(item.analysis?.concepts ?? []).join(' ')}`);
  const intersection = [...goalWords].filter(word => itemWords.has(word)).length;
  const lexicalMatch = goalWords.size ? intersection / goalWords.size : 0;
  // Unknown or empty goals receive a neutral prior instead of an invented semantic match.
  if (!total && !intersection) return 0.4;
  return unit(0.15 + 0.65 * topicMatch + 0.2 * lexicalMatch);
}

function validDecision(item: ContentItem): boolean {
  const decision = item.decision;
  return !!decision && [decision.relevance, decision.novelty, decision.actionability].every(value =>
    Number.isFinite(value) && value >= 0 && value <= 1);
}

/** Deterministic utility policy. These hand-set weights are not calibrated probabilities. */
export function rankItems(items: ContentItem[], profile: Profile): RankedItem[] {
  const mastered = new Set(profile.knownConcepts.map(normalize));
  const rows = items.map((item, inputIndex) => {
    const topics = topicsFor(item);
    const concepts = uniqueConcepts(item.analysis?.concepts ?? []);
    const knownConcepts = concepts.filter(concept => mastered.has(normalize(concept)));
    const newConcepts = concepts.filter(concept => !mastered.has(normalize(concept)));
    const overlap = concepts.length ? knownConcepts.length / concepts.length : 0;
    const preference = topics.length ? topics.reduce((sum, topic) => sum + unit(profile.interests[topic]), 0) / topics.length : 0.5;
    const localRelevance = goalRelevance(item, profile, topics);
    const localNovelty = concepts.length ? 1 - overlap : 0.5;
    const localActionability = item.kind === 'documentation' ? 0.8 : item.kind === 'paper' ? 0.5 : 0.6;
    const minutes = item.analysis?.readingMinutes;
    const timeCost = unit(typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes / 30 : 0.15);
    const knownPenalty = 0.12 * overlap + (item.feedback === 'known' ? 0.16 : 0);
    const feedbackAdjustment = item.feedback === 'useful' ? 0.04 : item.feedback === 'not_useful' ? -0.18 : 0;
    const utility = (relevance: number, novelty: number, actionability: number) => 100 * unit(
      0.4 * relevance + 0.26 * novelty + 0.16 * actionability + 0.18 * preference
      - 0.06 * timeCost - knownPenalty + feedbackAdjustment,
    );

    const current = validDecision(item) && item.decision!.profileVersion === profile.version;
    const stale = validDecision(item) && !current;
    const relevance = current ? 0.65 * item.decision!.relevance + 0.35 * localRelevance : localRelevance;
    const novelty = current ? 0.65 * item.decision!.novelty + 0.35 * localNovelty : localNovelty;
    const actionability = current ? item.decision!.actionability : localActionability;
    const scoreSource = current ? 'jev-personalized' : stale ? 'stale-jev' : 'local-baseline';
    const sourceReason = current ? 'Current Jev forecasts blended with your goal and feedback.'
      : stale ? 'Jev forecasts belong to an older profile; this score uses the local baseline until refreshed.'
      : item.decision ? 'Invalid model forecasts excluded; local baseline only.' : 'Local baseline; Jev has not scored this item.';
    const knowledgeReason = knownConcepts.length
      ? `${knownConcepts.length}/${concepts.length} tagged concepts marked known; prioritize ${newConcepts.length ? newConcepts.slice(0, 2).join(' and ') : 'a brief review'}.`
      : concepts.length ? 'No tagged concepts are marked known.' : 'Knowledge overlap is unknown because no concept tags are available.';

    return {
      item: {
        ...item, score: utility(relevance, novelty, actionability),
        baselineScore: utility(localRelevance, localNovelty, localActionability), rank: 0,
        scoreSource, breakdown: { relevance, novelty, actionability, preference, knowledgeOverlap: overlap, timeCost, knownPenalty },
        reason: `${sourceReason} ${knowledgeReason}`, newConcepts, knownConcepts,
      } satisfies RankedItem,
      inputIndex,
    };
  });
  return rows.sort((a, b) => b.item.score - a.item.score || a.inputIndex - b.inputIndex)
    .map(({ item }, index) => ({ ...item, rank: index + 1 }));
}

/** Event deduplication belongs at the persistence boundary, before calling this reducer. */
export function applyFeedback(profile: Profile, item: ContentItem, kind: FeedbackKind): Profile {
  const interests = { ...profile.interests };
  const topics = topicsFor(item);
  for (const topic of topics) {
    const previous = unit(interests[topic]);
    interests[topic] = kind === 'useful' ? previous + 0.22 * (1 - previous)
      : kind === 'not_useful' ? previous * 0.76 : previous;
  }
  // A useful read is a preference signal, not evidence of mastery. "Known" is an
  // explicit self-report about specific tags, never mastery of an entire topic.
  const markedKnown = kind === 'known'
    ? (item.analysis?.concepts ?? []).filter(concept => !BROAD_CONCEPTS.has(normalize(concept))) : [];
  return {
    ...profile, interests,
    knownConcepts: uniqueConcepts([...profile.knownConcepts, ...markedKnown]),
    feedbackCount: profile.feedbackCount + 1,
    version: profile.version + 1,
  };
}
