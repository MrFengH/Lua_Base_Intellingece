import type { ApproximateAge } from '../model/age';
import type { ContradictionField, FieldContradiction } from '../model/capture';

/**
 * How a later statement relates to the earlier one it disagrees with.
 *
 * `SelfCorrection` is reserved for wording that says, in the observer's own words, that the
 * earlier value was wrong. Everything else is `Undetermined`, which is the honest default: the
 * system records that two values were claimed and asks, instead of letting message order decide.
 */
export type RestatementIntent = 'SelfCorrection' | 'Undetermined';

/**
 * Hedged wording. A hedge never resolves a disagreement, even alongside a correction marker:
 * "perdón, quizá era Orion" is still a guess, so it must be asked about rather than accepted.
 */
const HEDGE_MARKERS =
  /\b(?:quiz[aá]s?|tal\s+vez|puede\s+que|acaso|creo\s+que|me\s+parece|acaso|no\s+estoy\s+segur[oa]|maybe|perhaps|possibly|i\s+think|i\s+believe|not\s+sure)\b/iu;

/**
 * Unambiguous self-correction wording, in Spanish and English. Deliberately a short list of
 * explicit phrases rather than a classifier: anything not on it stays `Undetermined`.
 */
const CORRECTION_MARKERS =
  /\b(?:en\s+realidad|realmente|perd[oó]n|perdona|disculpa|me\s+equivoqu[eé]|quise\s+decir|mejor\s+dicho|corrijo|correcci[oó]n|ahora\s+que\s+(?:lo\s+)?recuerdo|actually|sorry|i\s+meant|i\s+misspoke|in\s+fact|correction)\b/iu;

/**
 * Reads the observer's own wording to decide whether a differing value corrects the earlier one
 * or merely disagrees with it. It never inspects the values themselves, so it cannot be talked
 * into preferring one number over another.
 */
export const classifyRestatementIntent = (text: string): RestatementIntent => {
  if (HEDGE_MARKERS.test(text)) return 'Undetermined';
  return CORRECTION_MARKERS.test(text) ? 'SelfCorrection' : 'Undetermined';
};

/** Human-readable form of an age, used when a contradiction has to name both values. */
export const describeApproximateAge = (age: ApproximateAge): string => {
  if (age.type === 'unknown') return 'age unknown';
  if (age.type === 'qualitative') return age.label;
  if (age.type === 'exact') return `${age.years} years`;
  if (age.minYears === age.maxYears) return `approx. ${age.minYears} years`;
  return `${age.minYears}-${age.maxYears} years`;
};

const sameAge = (left: ApproximateAge, right: ApproximateAge): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === 'unknown') return true;
  if (left.type === 'qualitative' && right.type === 'qualitative') {
    return left.label.trim().toLocaleLowerCase('en') === right.label.trim().toLocaleLowerCase('en');
  }
  if (left.type === 'exact' && right.type === 'exact') return left.years === right.years;
  if (
    (left.type === 'estimate' || left.type === 'range') &&
    (right.type === 'estimate' || right.type === 'range')
  ) {
    return left.minYears === right.minYears && left.maxYears === right.maxYears;
  }
  return false;
};

/**
 * Value equality for contradiction detection. Text is compared case-insensitively so that
 * "NovaMed" restated as "novamed" is a repetition rather than a disagreement.
 */
export const sameFieldValue = (left: unknown, right: unknown): boolean => {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.trim().toLocaleLowerCase('en') === right.trim().toLocaleLowerCase('en');
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    return sameAge(left as ApproximateAge, right as ApproximateAge);
  }
  return left === right;
};

const FIELD_LABEL: Readonly<Record<ContradictionField, string>> = {
  Modality: 'modality',
  Quantity: 'quantity',
  Manufacturer: 'manufacturer',
  Model: 'model',
  ApproximateAge: 'age',
};

export const contradictionFieldLabel = (field: ContradictionField): string => FIELD_LABEL[field];

/**
 * The question that names both claims. It asks; it never suggests which one to keep, and the
 * order is chronological so the observer can tell which one they said first.
 */
export const contradictionQuestionText = (
  contradiction: FieldContradiction,
  equipmentLabel: string,
): string =>
  `Earlier you said the ${FIELD_LABEL[contradiction.field]} of the ${equipmentLabel} systems was ` +
  `${contradiction.previousText}, and then ${contradiction.currentText}. Which one should I keep?`;
