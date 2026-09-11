import type { ExtractionContext, ObservationExtractionPort } from '@/application/ports';
import type { InferenceRuntimeInfo, ObservationExtraction } from '@/application/contracts';
import { ObservationExtractionSchema } from '@/application/contracts';
import type { ApproximateAge, Modality } from '@/domain';
import { normalizeModality } from '@/domain';

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

const parseNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) return numeric;
  return NUMBER_WORDS[value.toLocaleLowerCase('en')] ?? null;
};

/** Matches only a number token at the very start of the text, unlike `parseNumber`, which
 * requires the whole string to be one. Lets a pending-question answer like "3, y tenían
 * alrededor de 7 años" still yield quantity 3 instead of failing to parse at all. */
const LEADING_NUMBER = new RegExp(`^(${Object.keys(NUMBER_WORDS).join('|')}|\\d+)\\b`, 'iu');

const leadingNumber = (text: string): number | null => parseNumber(text.match(LEADING_NUMBER)?.[1]);

/**
 * Age mentioned incidentally in an answer to a *different* pending question, e.g. "3, y tenían
 * alrededor de 7 años" answering a quantity question. Shares the approximate/exact/qualitative
 * vocabulary the full-sentence extractor already recognises (`extractEquipment` below), plus
 * "alrededor de", common spoken-Spanish phrasing for "around" that was otherwise only reachable
 * through a direct age question.
 */
const APPROX_AGE_MENTION =
  /(?:around|about|approximately|aproximadamente|alrededor\s+de|unos?|unas?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+years?|\s+a[nñ]os?)?/iu;
const EXACT_AGE_MENTION = /(?:aged?|de)\s+(\d+)\s*(?:years?|a[nñ]os?)/iu;
const QUALITATIVE_AGE_MENTION = /\b(newer?|old|recent(?:ly installed)?|nuevo|viejo|reciente)\b/iu;

const mentionedAge = (text: string): ApproximateAge | null => {
  const approx = text.match(APPROX_AGE_MENTION);
  const years = approx ? parseNumber(approx[1]) : null;
  if (years !== null) return { type: 'estimate', minYears: years, maxYears: years };
  const exact = text.match(EXACT_AGE_MENTION);
  if (exact?.[1]) return { type: 'exact', years: Number(exact[1]) };
  const qualitative = text.match(QUALITATIVE_AGE_MENTION);
  if (qualitative?.[1]) return { type: 'qualitative', label: qualitative[1] };
  return null;
};

/**
 * A manufacturer named with an explicit marker word, as opposed to a bare brand-name answer (a
 * plain "NovaMed."), which callers fall back to as-is. Stops at the first comma/period so a
 * trailing clause ("..., modelo NM-300, de unos ocho años") is never swept into the brand name.
 * Deliberately case-sensitive on the captured name (a real brand is capitalised) so the marker
 * alternation is spelled out both ways instead of using `/i`, which would also relax that.
 */
const MANUFACTURER_MENTION =
  /\b(?:[Ss]on|[Ee]s|de\s+la\s+marca|manufactured\s+by|[Bb]rand(?:\s+is)?)\s+([\p{Lu}][\p{L}\d]*(?:\s+[\p{Lu}][\p{L}\d]*)*)/u;

const mentionedManufacturer = (text: string): string | null =>
  text.match(MANUFACTURER_MENTION)?.[1]?.trim() ?? null;

/** A model named after "modelo"/"model", the same marker word used when Model is the pending field. */
const MODEL_MENTION = /\bmodelo?\s+([\p{L}\d][\p{L}\d-]*)/iu;

const mentionedModel = (text: string): string | null =>
  text.match(MODEL_MENTION)?.[1]?.trim() ?? null;

const modalityPattern =
  'MR(?:I)?|CT|computed tomography|magnetic resonance|resonadores?|tom[oó]grafos?|ultrasounds?|ultrasonidos?|x-?rays?|rayos x|patient monitors?|patient monitoring';

const blankExtraction = (): ObservationExtraction => ({
  customer: { name: null, city: null, country: null },
  equipment: [],
});

const correctedManufacturerAnswer = (answer: string): string => {
  const correction = answer.match(/^no\s+es\s+.+?,\s*es\s+(.+)$/iu);
  return correction?.[1]?.trim() ?? answer;
};

const pendingModality = (context: ExtractionContext): Modality => {
  const id =
    context.pendingQuestion?.target.type === 'Equipment'
      ? context.pendingQuestion.target.equipmentGroupId
      : null;
  const item = context.captureDraft?.equipment.find((candidate) => candidate.id === id);
  return item?.modality.state === 'Known' ? item.modality.value : 'Unknown';
};

const pendingAnswer = (text: string, context: ExtractionContext): ObservationExtraction | null => {
  const question = context.pendingQuestion;
  if (!question) return null;
  const answer = text.trim().replace(/[.!]$/, '');
  const result = blankExtraction();
  if (question.field === 'CustomerName') {
    result.customer.name = answer;
    return result;
  }
  if (question.field === 'Location') {
    const parts = answer
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      result.customer.city = parts[0] ?? null;
      result.customer.country = parts.at(-1) ?? null;
    } else {
      result.customer.country = answer;
    }
    return result;
  }
  // Provenance is derived by domain rules from the observer's own words, never by the extractor.
  if (question.field === 'ObservationBasis') return result;
  if (question.target.type !== 'Equipment') return null;
  const item: ObservationExtraction['equipment'][number] = {
    modality: pendingModality(context),
    rawModality: null,
    quantity: null,
    manufacturer: null,
    model: null,
    approximateAge: { type: 'unknown' } as ApproximateAge,
    notes: null,
    certainty: 'Explicit' as const,
  };
  if (question.field === 'Manufacturer') {
    const corrected = correctedManufacturerAnswer(answer);
    item.manufacturer = mentionedManufacturer(corrected) ?? corrected;
  }
  if (question.field === 'Model') item.model = mentionedModel(answer) ?? answer;
  if (question.field === 'Notes') item.notes = answer;
  if (question.field === 'Quantity') item.quantity = leadingNumber(answer) ?? parseNumber(answer);
  if (question.field === 'Modality') {
    item.modality = normalizeModality(answer);
    item.rawModality = answer;
  }
  if (question.field === 'ApproximateAge') {
    const years = parseNumber(answer.match(/(\d+|[a-záéíóúñ]+)/i)?.[1]);
    if (years !== null) {
      item.approximateAge = { type: 'estimate', minYears: years, maxYears: years };
    } else {
      item.approximateAge = { type: 'qualitative', label: answer };
    }
  }
  // The question above names the one field the observer was asked to answer, but a reply like
  // "3, y tenían alrededor de 7 años" (quantity pending) or "Son NovaMed, modelo NM-300, de unos
  // ocho años" (manufacturer pending) volunteers others in the same breath. Pick up anything the
  // primary field above did not already set, so it is captured now instead of asked about again —
  // `mergeEquipment` treats each of these independently either way, contradiction handling (P3-S6)
  // included, so this never overwrites a value silently.
  if (question.field !== 'ApproximateAge' && item.approximateAge.type === 'unknown') {
    const age = mentionedAge(answer);
    if (age) item.approximateAge = age;
  }
  if (question.field !== 'Manufacturer' && item.manufacturer === null) {
    item.manufacturer = mentionedManufacturer(answer);
  }
  if (question.field !== 'Model' && item.model === null) {
    item.model = mentionedModel(answer);
  }
  result.equipment.push(item);
  return result;
};

/**
 * Openers that mark a sentence as a second thought about something already said. The list is
 * deliberately short and anchored to the start of the message: it exists so a contradiction can
 * be reproduced deterministically in development, not to parse conversation.
 */
const RESTATEMENT =
  /^(?:perd[oó]n|perdona|disculpa|bueno|no|espera|oye|corrijo|creo\s+que|ahora\s+que\s+(?:lo\s+)?recuerdo|actually|sorry|wait|hold\s+on|correction)\b[,:]?\s+(?:en\s+realidad\s+|realmente\s+|mejor\s+dicho\s+|ahora\s+que\s+(?:lo\s+)?recuerdo\s+|quiz[aá]s?\s+|tal\s+vez\s+|creo\s+que\s+|i\s+think\s+|maybe\s+)*(?:eran|era|fueron|fue|son|es|hab[ií]an|hab[ií]a|ten[ií]an|tienen|were|was|are|is|it(?:'|’)?s|they(?:'|’)?re)?\b\s*(?:unos|unas|una|un|los|las|el|la|del|de|the|an|a|from)?\b\s*(.+?)[.!]*$/iu;

/**
 * Routes a restatement to the field it actually names, but only when that field already holds a
 * value and is not the one the pending question is asking about. Anything else falls through to
 * the ordinary answer path, so no existing flow changes.
 */
const restatement = (text: string, context: ExtractionContext): ObservationExtraction | null => {
  const draft = context.captureDraft;
  const group = draft?.equipment[0];
  if (!group || group.modality.state !== 'Known') return null;
  const value = text.trim().match(RESTATEMENT)?.[1]?.trim();
  if (!value) return null;

  const singleToken = /^(?:\d+|[\p{L}]+)$/u.test(value);
  // A restated modality is left alone: extraction groups equipment by modality, so it cannot
  // express "the same group is a different modality". That correction goes through review.
  if (normalizeModality(value) !== 'Unknown') return null;
  const quantity = singleToken ? parseNumber(value) : null;
  const field = quantity !== null ? 'Quantity' : /^\p{Lu}/u.test(value) ? 'Manufacturer' : null;
  if (field === null || field === context.pendingQuestion?.field) return null;
  if (field === 'Quantity' && group.quantity.state !== 'Known') return null;
  if (field === 'Manufacturer' && group.manufacturer.state !== 'Known') return null;

  // The modality is echoed only so the restatement merges into the group it is about. Certainty
  // stays `Explicit` because hedging in a restatement is read from the observer's wording by the
  // workflow's restatement rule; claiming it here would downgrade fields nobody restated.
  const result = blankExtraction();
  result.equipment.push({
    modality: group.modality.value,
    rawModality: null,
    quantity: field === 'Quantity' ? quantity : null,
    manufacturer: field === 'Manufacturer' ? value : null,
    model: null,
    approximateAge: { type: 'unknown' } as ApproximateAge,
    notes: null,
    certainty: 'Explicit' as const,
  });
  return result;
};

const extractCustomer = (
  text: string,
  context: ExtractionContext,
): ObservationExtraction['customer'] => {
  const known = context.knownCustomers.find((customer) =>
    text.toLocaleLowerCase('en').includes(customer.name.toLocaleLowerCase('en')),
  );
  let name = known?.name ?? null;
  const facility = text.match(
    /\b((?:hospital|clinic|cl[ií]nica)\s+[\p{L}\d][\p{L}\d\s'-]*?)(?=\s+(?:in|en)\s+[A-ZÁÉÍÓÚÑ]|\s+(?:has|have|tiene|tienen)\b|[,.]|$)/iu,
  );
  if (facility?.[1]) name = facility[1].trim();

  let city: string | null = known?.city ?? null;
  let country: string | null = known?.country ?? null;
  const location = text.match(
    /\b(?:in|en)\s+([A-ZÁÉÍÓÚÑ][\p{L}\s'-]+?)(?=[,.]|\s+(?:they|tienen|has|have)\b|$)/u,
  );
  if (location?.[1]) {
    const value = location[1].trim();
    if (value.includes(',')) {
      const parts = value.split(',').map((part) => part.trim());
      city = parts[0] ?? null;
      country = parts.at(-1) ?? null;
    } else {
      country = value;
    }
  }
  return { name, city, country };
};

const extractHeterogeneousAgeGroups = (text: string): ObservationExtraction['equipment'] | null => {
  const modalityMatch = text.match(
    new RegExp(`\\b(?:\\d+|[a-záéíóúñ]+)\\s+(${modalityPattern})\\b`, 'iu'),
  );
  if (!modalityMatch?.[1]) return null;
  const groups = [
    ...text.matchAll(
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:are\s+|is\s+|seem\s+|seems\s+|look\s+|looks\s+)?(?:around|about|approximately|aproximadamente|unos?|unas?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+years?|\s+a[nñ]os?)?/giu,
    ),
  ];
  if (groups.length < 2) return null;
  const modality = normalizeModality(modalityMatch[1]);
  return groups.map((group) => {
    const quantity = parseNumber(group[1]);
    const age = parseNumber(group[2]);
    return {
      modality,
      rawModality: modalityMatch[1] ?? null,
      quantity,
      manufacturer: null,
      model: null,
      approximateAge:
        age === null
          ? ({ type: 'unknown' } as const)
          : ({ type: 'estimate', minYears: age, maxYears: age } as const),
      notes: null,
      certainty: 'Uncertain' as const,
    };
  });
};

const extractEquipment = (text: string): ObservationExtraction['equipment'] => {
  const heterogeneous = extractHeterogeneousAgeGroups(text);
  if (heterogeneous) return heterogeneous;

  const equipment: ObservationExtraction['equipment'] = [];
  const expression = new RegExp(
    `\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\\s+(${modalityPattern})\\b`,
    'giu',
  );
  for (const match of text.matchAll(expression)) {
    const rawModality = match[2] ?? '';
    const nearby = text.slice(match.index, Math.min(text.length, match.index + 140));
    const ageMatch = nearby.match(
      /(?:around|about|approximately|aproximadamente|unos?|unas?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|ocho|nueve)(?:\s+years?|\s+a[nñ]os?)/iu,
    );
    const exactAgeMatch = nearby.match(/(?:aged?|de)\s+(\d+)\s*(?:years?|a[nñ]os?)/iu);
    const qualitativeMatch = nearby.match(
      /\b(newer?|old|recent(?:ly installed)?|nuevo|viejo|reciente)\b/iu,
    );
    let approximateAge: ApproximateAge = { type: 'unknown' };
    let certainty: 'Explicit' | 'Uncertain' | 'Unknown' = 'Explicit';
    if (ageMatch) {
      const years = parseNumber(ageMatch[1]);
      if (years !== null) approximateAge = { type: 'estimate', minYears: years, maxYears: years };
      certainty = 'Uncertain';
    } else if (exactAgeMatch?.[1]) {
      approximateAge = { type: 'exact', years: Number(exactAgeMatch[1]) };
    } else if (qualitativeMatch?.[1]) {
      approximateAge = { type: 'qualitative', label: qualitativeMatch[1] };
      certainty = 'Uncertain';
    }
    equipment.push({
      modality: normalizeModality(rawModality),
      rawModality,
      quantity: parseNumber(match[1]),
      manufacturer: null,
      model: null,
      approximateAge,
      notes: null,
      certainty,
    });
  }
  return equipment;
};

/** Deterministic local fixture parser. It is intentionally not a production inference engine. */
export class DevelopmentMockObservationExtractionService implements ObservationExtractionPort {
  readonly kind = 'development-mock' as const;
  private readonly runtime: InferenceRuntimeInfo = {
    engine: 'Development Mock',
    execution: 'Development only',
    model: 'Generador de datos de prueba',
    networkRequiredForInference: false,
    status: 'ready',
    detail: 'No válido para la demo final de QVAC.',
    progressPercent: 100,
  };

  async initialize(): Promise<InferenceRuntimeInfo> {
    return this.getRuntimeInfo();
  }

  getRuntimeInfo(): InferenceRuntimeInfo {
    return { ...this.runtime };
  }

  async extract(text: string, context: ExtractionContext): Promise<ObservationExtraction> {
    const candidate =
      restatement(text, context) ??
      pendingAnswer(text, context) ??
      ({
        customer: extractCustomer(text, context),
        equipment: extractEquipment(text),
      } satisfies ObservationExtraction);
    return ObservationExtractionSchema.parse(candidate);
  }

  async dispose(): Promise<void> {}
}
