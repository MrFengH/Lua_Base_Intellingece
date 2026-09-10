import { CHALLENGE_BRIEF_CASES } from './cases/challenge-brief';
import { OFFICIAL_INSTALLED_BASE_ROW_CASES } from './cases/official-installed-base-rows';
import { OFFICIAL_VOICE_PROMPT_CASES } from './cases/official-voice-prompts';
import { PROJECT_AUTHORED_CASES } from './cases/project-authored';
import type { CorpusCase } from './types';

/**
 * Bumped whenever a case's expectations change in a way that would make an old pass rate
 * incomparable to a new one, mirroring `confidence-v1` / `duplicate-v1` elsewhere in this
 * codebase. See docs/DECISIONS.md.
 */
export const EXTRACTION_CORPUS_VERSION = 'extraction-corpus-v1';

export const EXTRACTION_CORPUS: readonly CorpusCase[] = [
  ...OFFICIAL_VOICE_PROMPT_CASES,
  ...OFFICIAL_INSTALLED_BASE_ROW_CASES,
  ...CHALLENGE_BRIEF_CASES,
  ...PROJECT_AUTHORED_CASES,
];

export * from './cases/challenge-brief';
export * from './cases/official-installed-base-rows';
export * from './cases/official-voice-prompts';
export * from './cases/project-authored';
export * from './evaluator';
export * from './types';
