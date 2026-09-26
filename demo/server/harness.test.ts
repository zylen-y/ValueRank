import { describe, expect, it } from 'vitest';
import { analysisSchema, validateEvidence } from './harness.ts';

const source = 'A spaced review scheduler predicts retention from previous answers.\n\nCompare recall after seven days with the baseline.';
const valid = () => ({
  summary: 'The supplied excerpt proposes evaluating a review scheduler with delayed recall against a baseline.',
  concepts: ['Delayed recall', 'Spaced review scheduling'],
  topics: ['language', 'ranking'],
  evidence: [{ quote: 'Compare recall after seven days with the baseline.', insight: 'Use a delayed evaluation target rather than immediate engagement.' }],
  readingMinutes: 3,
});

// These tests exercise pure validation only; analyzeSource is never invoked.
describe('source quotation provenance', () => {
  it('accepts an actual contiguous source quotation', () => {
    expect(() => validateEvidence(source, valid())).not.toThrow();
  });

  it('normalizes harmless whitespace without changing wording', () => {
    const analysis = valid();
    analysis.evidence[0].quote = 'answers. Compare recall after seven days';
    expect(() => validateEvidence(source, analysis)).not.toThrow();
  });

  it('rejects paraphrased or invented quotes even when meaning is plausible', () => {
    const analysis = valid();
    analysis.evidence[0].quote = 'Compare retention after one week with the baseline.';
    expect(() => validateEvidence(source, analysis)).toThrow('Evidence validation failed');
  });

  it('rejects noncontiguous word stitching', () => {
    const analysis = valid();
    analysis.evidence[0].quote = 'A spaced review scheduler Compare recall';
    expect(() => validateEvidence(source, analysis)).toThrow('Evidence validation failed');
  });

  it('rejects an evidence set if even one quote is unsupported', () => {
    const analysis = valid();
    analysis.evidence.push({ quote: 'The scheduler improved recall by 40 percent.', insight: 'An invented numerical claim.' });
    expect(() => validateEvidence(source, analysis)).toThrow('Evidence validation failed');
  });

  it.each(['', ' '.repeat(20), '\n\t\r'.repeat(10)])('rejects empty or whitespace-only quoted evidence', (quote) => {
    const analysis = valid();
    analysis.evidence[0].quote = quote;
    expect(() => validateEvidence(source, analysis)).toThrow('Evidence validation failed');
  });

  it('requires at least one quoted source span', () => {
    expect(() => validateEvidence(source, { evidence: [] })).toThrow('Evidence validation failed');
  });

  it('does not treat quote matching as semantic verification', () => {
    const analysis = valid();
    analysis.evidence[0].insight = 'A claim that the excerpt does not actually establish.';
    // This explicitly documents the checker’s limited guarantee.
    expect(() => validateEvidence(source, analysis)).not.toThrow();
  });
});

describe('LLM structured-output boundaries', () => {
  it('accepts bounded well-formed analysis', () => {
    expect(analysisSchema.safeParse(valid()).success).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 91, 1.5, '3', null])('rejects invalid readingMinutes %s', (readingMinutes) => {
    expect(analysisSchema.safeParse({ ...valid(), readingMinutes }).success).toBe(false);
  });

  it('rejects oversized text, invalid topics, and unbounded arrays', () => {
    expect(analysisSchema.safeParse({ ...valid(), summary: 'a'.repeat(701) }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...valid(), concepts: Array(8).fill('Specific concept') }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...valid(), topics: ['invented-topic'] }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...valid(), evidence: [] }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...valid(), evidence: [{ quote: 'x'.repeat(261), insight: 'Long enough insight' }] }).success).toBe(false);
  });
});
