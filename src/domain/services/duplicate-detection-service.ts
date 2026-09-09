import type {
  ApproximateAge,
  DuplicateComparableObservation,
  DuplicateReason,
  DuplicateScore,
} from '../model';
import { normalizeName } from '../rules';

const ageInterval = (age: ApproximateAge): { min: number; max: number } | null => {
  if (age.type === 'exact') return { min: age.years, max: age.years };
  if (age.type === 'estimate' || age.type === 'range') {
    return { min: age.minYears, max: age.maxYears };
  }
  return null;
};

const sameText = (a: string, b: string): boolean => normalizeName(a) === normalizeName(b);

export class DuplicateDetectionService {
  score(
    source: DuplicateComparableObservation,
    candidate: DuplicateComparableObservation,
  ): DuplicateScore {
    const reasons: DuplicateReason[] = [];
    if (source.customerId !== candidate.customerId) {
      reasons.push({ code: 'DIFFERENT_CUSTOMER', detail: 'Different customer.', contribution: 0 });
      return this.noMatch(reasons);
    }
    reasons.push({ code: 'SAME_CUSTOMER', detail: 'Same customer.', contribution: 0.3 });

    if (source.modality === 'Unknown' || candidate.modality === 'Unknown') {
      reasons.push({ code: 'UNKNOWN_MODALITY', detail: 'Modality is unknown.', contribution: 0 });
      return this.noMatch(reasons);
    }
    if (source.modality !== candidate.modality) {
      reasons.push({ code: 'DIFFERENT_MODALITY', detail: 'Different modality.', contribution: 0 });
      return this.noMatch(reasons);
    }
    reasons.push({ code: 'SAME_MODALITY', detail: 'Same modality.', contribution: 0.3 });

    let score = 0.6;
    let conflict = false;
    if (source.manufacturer && candidate.manufacturer) {
      if (sameText(source.manufacturer, candidate.manufacturer)) {
        score += 0.12;
        reasons.push({
          code: 'SAME_MANUFACTURER',
          detail: 'Same manufacturer.',
          contribution: 0.12,
        });
      } else {
        conflict = true;
        reasons.push({
          code: 'DIFFERENT_MANUFACTURER',
          detail: 'Manufacturer differs.',
          contribution: -0.12,
        });
        score -= 0.12;
      }
    }
    if (source.model && candidate.model) {
      if (sameText(source.model, candidate.model)) {
        score += 0.2;
        reasons.push({ code: 'SAME_MODEL', detail: 'Same model.', contribution: 0.2 });
      } else {
        conflict = true;
        score -= 0.2;
        reasons.push({ code: 'DIFFERENT_MODEL', detail: 'Model differs.', contribution: -0.2 });
      }
    }

    const sourceAge = ageInterval(source.approximateAge);
    const candidateAge = ageInterval(candidate.approximateAge);
    if (sourceAge && candidateAge) {
      const compatible =
        sourceAge.min <= candidateAge.max + 1 && candidateAge.min <= sourceAge.max + 1;
      score += compatible ? 0.08 : -0.08;
      reasons.push({
        code: compatible ? 'COMPATIBLE_AGE' : 'INCOMPATIBLE_AGE',
        detail: compatible ? 'Age ranges are compatible.' : 'Age ranges are incompatible.',
        contribution: compatible ? 0.08 : -0.08,
      });
      conflict ||= !compatible;
    }

    const independentObserver =
      Boolean(source.observerId && candidate.observerId) &&
      source.observerId !== candidate.observerId;
    const independentVisit =
      Boolean(source.visitId && candidate.visitId) && source.visitId !== candidate.visitId;
    if (independentObserver) {
      reasons.push({
        code: 'INDEPENDENT_OBSERVER',
        detail: 'Reported by a different observer.',
        contribution: 0,
      });
    }
    if (independentVisit) {
      reasons.push({
        code: 'INDEPENDENT_VISIT',
        detail: 'Reported during a different visit.',
        contribution: 0,
      });
    }

    const normalizedScore = Number(Math.max(0, Math.min(1, score)).toFixed(2));
    const isCandidate = normalizedScore >= 0.65;
    return {
      score: normalizedScore,
      isCandidate,
      relationship: conflict
        ? 'PossibleConflict'
        : isCandidate && (independentObserver || independentVisit)
          ? 'PossibleCorroboration'
          : isCandidate
            ? 'PossibleDuplicate'
            : 'PartialMatch',
      reasons,
      algorithmVersion: 'duplicate-v1',
    };
  }

  private noMatch(reasons: DuplicateReason[]): DuplicateScore {
    return {
      score: 0,
      isCandidate: false,
      relationship: 'NoMatch',
      reasons,
      algorithmVersion: 'duplicate-v1',
    };
  }
}
