/**
 * Explicit cross-group scope markers an observer can use to say one answer applies to more than
 * one equipment group at once ("NovaMed para ambos"). Deliberately a short list of unambiguous
 * phrases rather than general coreference resolution: anything else stays scoped to the single
 * group the pending question was about, which is the honest default.
 *
 * `Both` phrases claim exactly two groups; `All` phrases claim the entire set. This classifier
 * only reads the words — the caller is responsible for checking that a `Both` claim actually
 * matches a draft with exactly two equipment groups before treating it as unambiguous.
 */
export type CrossGroupScope = 'Both' | 'All';

const BOTH_MARKERS =
  /\b(?:para\s+amb(?:os|as)|para\s+l(?:os|as)\s+dos|amb(?:os|as)\s+son|for\s+both|both\s+of\s+them)\b/iu;

const ALL_MARKERS =
  /\b(?:para\s+tod(?:os|as)|tod(?:os|as)\s+son|for\s+all|all\s+of\s+them|they(?:'|’)?re\s+all|they\s+are\s+all)\b/iu;

export const classifyCrossGroupScope = (text: string): CrossGroupScope | null => {
  if (ALL_MARKERS.test(text)) return 'All';
  if (BOTH_MARKERS.test(text)) return 'Both';
  return null;
};
