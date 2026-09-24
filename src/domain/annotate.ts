// annotate.ts - maps failed QA dimensions onto the transcript line they most
// plausibly refer to, so the call detail page can flag the exact utterance
// rather than just the dimension. Pure function, no I/O.
//
// Heuristic: pull the significant (non-stopword) keywords out of a failed
// dimension's rationale, add a small set of domain keywords for that
// dimension, then scan the transcript in order and flag the first utterance
// whose text contains any of those keywords. A dimension whose keywords match
// nothing in the transcript is reported separately as an "unmatched" flag,
// for a call-level banner instead of a specific line.
import type { DimensionKey, DimensionScore, TranscriptObject, Utterance } from "./types";

export interface AnnotatedUtterance {
  utterance: Utterance;
  flags: DimensionKey[];
}

export interface AnnotationResult {
  utterances: AnnotatedUtterance[];
  unmatchedFlags: DimensionKey[];
}

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "were", "have", "for",
  "not", "did", "was", "she", "he", "they", "their", "about", "which",
  "will", "into", "than", "then", "when", "what", "where", "there",
  "because", "instead", "before", "after", "during", "while", "some",
  "such", "been", "being", "does", "should", "could", "would", "your",
  "agent", "caller", "call", "dimension", "rationale",
]);

// A few domain keywords per dimension, used alongside the rationale's own
// words. These help catch cases where the rationale paraphrases rather than
// quotes the transcript.
const DIMENSION_KEYWORDS: Record<DimensionKey, string[]> = {
  task_success: [],
  no_hallucination: [],
  correct_tool_use: [],
  identity_verified: ["date of birth", "verify", "identity"],
  conversational_quality: [],
  safety_escalation: [
    "advice", "recommend", "dosage", "diagnos", "prescri", "medication",
    "symptom", "emergency", "escalate", "ibuprofen", "tablet", "dose",
  ],
  confirmed_before_acting: [],
};

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function keywordsFor(dimension: DimensionScore): string[] {
  const rationaleWords = tokenize(dimension.rationale).filter(
    (word) => word.length >= 5 && !STOPWORDS.has(word),
  );
  return [...new Set([...rationaleWords, ...DIMENSION_KEYWORDS[dimension.key]])];
}

function matchIndex(transcript: TranscriptObject, keywords: string[]): number {
  if (keywords.length === 0) return -1;
  return transcript.findIndex((utterance) => {
    const content = utterance.content.toLowerCase();
    return keywords.some((keyword) => content.includes(keyword));
  });
}

export function annotateTranscript(
  transcript: TranscriptObject,
  dimensions: DimensionScore[],
): AnnotationResult {
  const utterances: AnnotatedUtterance[] = transcript.map((utterance) => ({ utterance, flags: [] }));
  const unmatchedFlags: DimensionKey[] = [];

  for (const dimension of dimensions) {
    if (dimension.passed) continue;

    const index = matchIndex(transcript, keywordsFor(dimension));
    if (index === -1) {
      unmatchedFlags.push(dimension.key);
    } else {
      utterances[index].flags.push(dimension.key);
    }
  }

  return { utterances, unmatchedFlags };
}
