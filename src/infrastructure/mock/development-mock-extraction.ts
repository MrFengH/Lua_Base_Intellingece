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

const modalityPattern =
  'MR(?:I)?|CT|computed tomography|magnetic resonance|resonadores?|tom[oó]grafos?|ultrasounds?|ultrasonidos?|x-?rays?|rayos x|patient monitors?|patient monitoring';

const blankExtraction = (): ObservationExtraction => ({
  customer: { name: null, city: null, country: null },
  equipment: [],
});

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
  if (question.field === 'Manufacturer') item.manufacturer = answer;
  if (question.field === 'Model') item.model = answer;
  if (question.field === 'Notes') item.notes = answer;
  if (question.field === 'Quantity') item.quantity = parseNumber(answer);
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
  result.equipment.push(item);
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
    model: 'Deterministic fixture parser',
    networkRequiredForInference: false,
    status: 'ready',
    detail: 'Not valid for the final QVAC demonstration.',
    progressPercent: 100,
  };

  async initialize(): Promise<InferenceRuntimeInfo> {
    return this.getRuntimeInfo();
  }

  getRuntimeInfo(): InferenceRuntimeInfo {
    return { ...this.runtime };
  }

  async extract(text: string, context: ExtractionContext): Promise<ObservationExtraction> {
    const pending = pendingAnswer(text, context);
    const candidate =
      pending ??
      ({
        customer: extractCustomer(text, context),
        equipment: extractEquipment(text),
      } satisfies ObservationExtraction);
    return ObservationExtractionSchema.parse(candidate);
  }

  async dispose(): Promise<void> {}
}
