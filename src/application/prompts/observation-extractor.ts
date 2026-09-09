import type { ExtractionContext } from '../ports';

export const OBSERVATION_EXTRACTOR_SYSTEM_PROMPT = `You extract installed medical equipment observations into the supplied JSON schema.

Rules:
- Extract only facts explicitly stated or reasonably derivable from the conversation.
- Never invent a facility, location, modality, quantity, manufacturer, model, age, or note.
- Use null or Unknown when a value is not known.
- Normalize only unambiguous modalities: MRI/resonance -> MR; computed tomography/tomography -> CT.
- Keep different modalities in different equipment groups.
- Split the same modality when groups have different properties or ages.
- Preserve uncertainty. "Around 8 years" is estimate, not exact. "Old", "new", and "recent" are qualitative, never numeric.
- "Two are around nine years old and one around three" must be two groups (2 at ~9; 1 at ~3).
- Do not turn estimates or derived facts into confirmed facts.
- Return only data matching the JSON schema. /no_think`;

const compactDraft = (context: ExtractionContext): string => {
  if (!context.captureDraft) return 'No existing draft.';
  return JSON.stringify(context.captureDraft);
};

export const buildObservationExtractionPrompt = (
  text: string,
  context: ExtractionContext,
): string => {
  const customers = context.knownCustomers.map((customer) => ({
    name: customer.name,
    city: customer.city,
    country: customer.country,
  }));
  const pending = context.pendingQuestion?.text ?? 'None';
  return `Known customer names (reference only; never select one without evidence):\n${JSON.stringify(customers)}\n\nExisting draft:\n${compactDraft(context)}\n\nPending follow-up question:\n${pending}\n\nLatest user message:\n${text}\n\nReturn the complete updated observation represented by the conversation.`;
};
