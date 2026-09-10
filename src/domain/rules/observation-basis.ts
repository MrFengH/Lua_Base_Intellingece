import type { ApproximateAge } from '../model/age';
import type { DraftField } from '../model/capture';
import type { ObservationBasis, ObservationStatus } from '../model/enums';

/**
 * Explicit provenance markers, in Spanish and English. This is deliberately a short list of
 * unambiguous phrases rather than a language classifier: when nothing matches, the observation
 * basis stays unknown and the follow-up question asks, which is the honest outcome.
 */
const REPORTED_MARKERS =
  /\b(?:me\s+(?:lo\s+)?(?:dijeron|dijo|coment(?:aron|ó|o)|report(?:aron|ó|o)|indic(?:aron|ó|o))|seg[uú]n\s+(?:el|la|los|las|me)|me\s+han\s+dicho|de\s+segunda\s+mano|por\s+referencia|(?:they|he|she|someone|the\s+\w+)\s+told\s+me|told\s+me|was\s+reported\s+to\s+me|reported\s+to\s+me|according\s+to|second[-\s]?hand)\b/iu;

const ESTIMATE_MARKERS =
  /\b(?:creo\s+que|me\s+parece\s+que|supongo|calculo\s+que|estimo|es\s+una\s+estimaci[oó]n|una\s+estimaci[oó]n|deben\s+(?:de\s+)?tener|dir[ií]a\s+que|i\s+(?:think|guess|believe|reckon)|i\s*(?:'|’)?d\s+say|(?:it\s+is|it's|that's|that\s+is)\s+(?:an?\s+)?(?:estimate|guess)|estimated|my\s+best\s+guess)\b/iu;

const DIRECT_MARKERS =
  /(?<!\bno\s)(?<!\bnunca\s)\b(?:lo\s+vi|los\s+vi|las\s+vi|la\s+vi|vi\s+(?:directamente|personalmente|yo\s+mismo|dos|tres|un|una|uno|cuatro|cinco|seis|siete|ocho|nueve|diez|\d)|los\s+observ[eé]|observ[eé]\s+directamente|en\s+persona|con\s+mis\s+propios\s+ojos|yo\s+mismo\s+(?:lo|los|las)?\s*vi|i\s+saw\s+(?:them|it|the)|saw\s+them\s+myself|i\s+observed\s+(?:them|it|the)|directly\s+observed|observed\s+(?:them|it)\s+directly|first[-\s]?hand|in\s+person|with\s+my\s+own\s+eyes)\b/iu;

/**
 * Recognises an explicit statement about how the observer knows what they are reporting.
 * Returns `null` whenever the wording does not make the source plain, so that the caller asks
 * instead of guessing. `Reported` outranks `Estimate`, which outranks `DirectObservation`,
 * because a hedged retelling is still a retelling.
 */
export const classifyObservationBasis = (text: string): ObservationBasis | null => {
  const value = text.trim();
  if (!value) return null;
  if (REPORTED_MARKERS.test(value)) return 'ReportedByOther';
  if (ESTIMATE_MARKERS.test(value)) return 'Estimate';
  if (DIRECT_MARKERS.test(value)) return 'DirectObservation';
  return null;
};

/** Short affirmative answers to the three-way provenance question, which carry no other wording. */
const SHORT_BASIS_ANSWERS: ReadonlyArray<readonly [RegExp, ObservationBasis]> = [
  [/^(?:reportad[oa]|reported|me\s+lo\s+reportaron|reporte|report)\b/iu, 'ReportedByOther'],
  [
    /^(?:una?\s+)?(?:estimaci[oó]n|estimad[oa]|estimate[ds]?|guess|an?\s+(?:estimate|guess))\b/iu,
    'Estimate',
  ],
  [
    /^(?:directamente|directa|direct(?:ly)?(?:\s+observed)?|observaci[oó]n\s+directa|los?\s+vi|las?\s+vi|vi)\b/iu,
    'DirectObservation',
  ],
];

/**
 * The reply to the provenance question. It accepts the short answers the question invites
 * ("directly", "reported", "an estimate") as well as a full sentence, and still returns `null`
 * when neither applies.
 */
export const classifyObservationBasisAnswer = (text: string): ObservationBasis | null => {
  const value = text.trim();
  for (const [pattern, basis] of SHORT_BASIS_ANSWERS) {
    if (pattern.test(value)) return basis;
  }
  return classifyObservationBasis(value);
};

/**
 * Observation status is the provenance of the account, never the precision of a field. A stated
 * or answered basis decides it. The age-derived rule survives only as the fallback for an
 * observation whose provenance was never stated, which is the behaviour every record written
 * before this rule existed relied on.
 */
export const deriveObservationStatus = (
  observationBasis: DraftField<ObservationBasis>,
  approximateAge: ApproximateAge,
): ObservationStatus => {
  if (observationBasis.state === 'Known') {
    if (observationBasis.value === 'DirectObservation') return 'Confirmed';
    if (observationBasis.value === 'ReportedByOther') return 'Reported';
    return 'Estimated';
  }
  if (observationBasis.state === 'DeclaredUnknown') return 'Unknown';
  return approximateAge.type === 'estimate' || approximateAge.type === 'range'
    ? 'Estimated'
    : 'Reported';
};
