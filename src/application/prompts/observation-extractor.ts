import type { ExtractionContext } from '../ports';

export const OBSERVATION_EXTRACTOR_SYSTEM_PROMPT = `You extract installed medical equipment observations into the supplied JSON schema.

Rules:
- Extract only facts explicitly stated or reasonably derivable from the conversation.
- Never invent a facility, location, modality, quantity, manufacturer, model, or age that the
  conversation does not state. When a field is not mentioned at all, or the speaker says they do
  not know it, its value is the JSON null (or, for approximateAge, {"type":"unknown"}) — never a
  placeholder word. Do not write the string "Unknown", "N/A", "None", or any other stand-in text
  into a field's value; a placeholder string is just as fabricated as a guessed one.
- For approximateAge specifically: if no age, install date, or age-related remark is mentioned for
  a group, return {"type":"unknown"}. Never default to an estimate of 0 years or any other guessed
  number just because a value is required.
- Normalize only unambiguous modalities: MRI/resonance -> MR; computed tomography/tomography -> CT.
- Keep different modalities in different equipment groups.
- Split the same modality when groups have different properties or ages.
- Preserve uncertainty. "Around 8 years" is estimate, not exact. Qualitative age descriptions
  (old, very old, new, mostly new, relatively new, recently installed; viejo, muy viejo, nuevo,
  bastante nuevo, reciente, and similar) are qualitative labels, never numeric — do not convert
  them into an invented year range.
- "Two are around nine years old and one around three" must be two groups (2 at ~9; 1 at ~3).
- Do not turn estimates or derived facts into confirmed facts.
- Set each equipment group's certainty using only what that group's own statement sounds like:
  "Uncertain" when the speaker hedges what they are reporting (e.g. "I think", "probably",
  "maybe", "around", "approximately", "creo que", "quizás", "tal vez", "parece que",
  "aproximadamente", "unos/unas" before a number); "Explicit" when the statement is direct and
  unhedged, even if some of its fields are simply not mentioned. Do not use hedge words as a
  reason to fabricate a field instead of leaving it null.
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
