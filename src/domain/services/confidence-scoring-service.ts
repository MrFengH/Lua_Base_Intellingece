import type { ConfidenceAssessment, ConfidenceFact } from '../model';

export interface ConfidenceScoringService {
  assess(facts: readonly ConfidenceFact[]): ConfidenceAssessment;
}

export class SimpleConfidenceScoringService implements ConfidenceScoringService {
  assess(facts: readonly ConfidenceFact[]): ConfidenceAssessment {
    const known = facts.filter((fact) => fact.knowledgeState === 'Known');
    const evidenceIds = [...new Set(known.flatMap((fact) => fact.evidenceIds ?? []))];

    if (known.length === 0) {
      return {
        level: 'Unknown',
        score: null,
        reasons: [{ code: 'NO_KNOWN_FACTS', detail: 'No factual value was reported.' }],
        evidenceIds,
        strategyVersion: 'confidence-v1',
      };
    }

    const explicit = known.filter((fact) => fact.certainty === 'Explicit').length;
    const uncertain = known.filter((fact) => fact.certainty === 'Uncertain').length;
    const derived = known.filter((fact) => fact.origin === 'Derived').length;
    const incomplete = facts.filter((fact) => fact.knowledgeState !== 'Known').length;
    const total = Math.max(facts.length, 1);
    const score = Math.max(0, Math.min(1, (explicit + uncertain * 0.55 + derived * 0.4) / total));
    const reasons: ConfidenceAssessment['reasons'][number][] = [];
    if (explicit > 0) {
      reasons.push({ code: 'EXPLICIT_FACTS', detail: `${explicit} explicit fact(s).` });
    }
    if (uncertain > 0) {
      reasons.push({ code: 'UNCERTAINTY_LANGUAGE', detail: `${uncertain} uncertain fact(s).` });
    }
    if (derived > 0) {
      reasons.push({ code: 'DERIVED_FACTS', detail: `${derived} derived fact(s).` });
    }
    if (incomplete > 0) {
      reasons.push({ code: 'INCOMPLETE_FIELDS', detail: `${incomplete} incomplete field(s).` });
    }

    return {
      level: score >= 0.75 ? 'High' : score >= 0.45 ? 'Medium' : 'Low',
      score: Number(score.toFixed(2)),
      reasons,
      evidenceIds,
      strategyVersion: 'confidence-v1',
    };
  }
}
