import { describe, expect, it } from 'vitest';
import type { ObservationExtraction } from '@/application/contracts';
import { MODALITIES } from '@/domain/model/enums';
import {
  CORPUS_CASE_SOURCES,
  EXTRACTION_CORPUS,
  declaredUnknown,
  evaluateCase,
  known,
  loadCorpus,
  mustNotInfer,
  validateCorpus,
  type ActualExtractionResult,
  type CorpusCase,
} from '../fixtures/corpus';

const extraction = (
  overrides: Partial<ObservationExtraction['customer']> = {},
  equipment: ObservationExtraction['equipment'] = [],
): ActualExtractionResult => ({
  extraction: {
    customer: { name: null, city: null, country: null, ...overrides },
    equipment,
  },
});

const equipmentGroup = (
  overrides: Partial<ObservationExtraction['equipment'][number]> = {},
): ObservationExtraction['equipment'][number] => ({
  modality: 'MR',
  rawModality: null,
  quantity: null,
  manufacturer: null,
  model: null,
  approximateAge: { type: 'unknown' },
  notes: null,
  certainty: null,
  ...overrides,
});

describe('extraction corpus: loading and consistency', () => {
  it('loads every case without touching QVAC', () => {
    const cases = loadCorpus(EXTRACTION_CORPUS);
    expect(cases.length).toBe(EXTRACTION_CORPUS.length);
    expect(cases.length).toBeGreaterThan(0);
  });

  it('gives every case a unique id', () => {
    const ids = EXTRACTION_CORPUS.map((corpusCase) => corpusCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every case a recognised source and a non-empty locator', () => {
    for (const corpusCase of EXTRACTION_CORPUS) {
      expect(CORPUS_CASE_SOURCES).toContain(corpusCase.origin.source);
      expect(corpusCase.origin.locator.length).toBeGreaterThan(0);
    }
  });

  it('validates the whole corpus with no structural problems', () => {
    expect(validateCorpus(EXTRACTION_CORPUS)).toEqual([]);
  });

  it('flags an inconsistent case instead of passing it silently', () => {
    const broken: CorpusCase = {
      id: 'broken-case',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedEquipment: [
        {
          quantity: known(-1),
          approximateAge: known({ type: 'estimate', minYears: 9, maxYears: 3 }),
        },
      ],
    };
    const problems = validateCorpus([broken]);
    expect(problems.some((problem) => problem.includes('quantity'))).toBe(true);
    expect(problems.some((problem) => problem.includes('approximateAge'))).toBe(true);
  });

  it('keeps every expected modality within the official vocabulary', () => {
    for (const corpusCase of EXTRACTION_CORPUS) {
      for (const group of corpusCase.expectedEquipment ?? []) {
        if (group.modality?.kind === 'Known') {
          expect(MODALITIES).toContain(group.modality.value);
        }
      }
    }
  });

  it('keeps every expected age in a valid representation', () => {
    for (const corpusCase of EXTRACTION_CORPUS) {
      for (const group of corpusCase.expectedEquipment ?? []) {
        if (group.approximateAge?.kind !== 'Known') continue;
        const age = group.approximateAge.value;
        if (age.type === 'estimate' || age.type === 'range') {
          expect(age.minYears).toBeLessThanOrEqual(age.maxYears);
        }
        if (age.type === 'qualitative') {
          expect(age.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('asserts at least one absence (DeclaredUnknown or MustNotInfer) in every case (P4-S2)', () => {
    const asserted = (field: { kind: string } | undefined): boolean =>
      field?.kind === 'DeclaredUnknown' || field?.kind === 'MustNotInfer';
    const casesWithNoAbsence = EXTRACTION_CORPUS.filter((corpusCase) => {
      const customer = corpusCase.expectedCustomer;
      const customerHasAbsence =
        asserted(customer?.name) || asserted(customer?.city) || asserted(customer?.country);
      const equipmentHasAbsence = (corpusCase.expectedEquipment ?? []).some(
        (group) =>
          asserted(group.modality) ||
          asserted(group.quantity) ||
          asserted(group.manufacturer) ||
          asserted(group.model) ||
          asserted(group.approximateAge) ||
          asserted(group.certainty),
      );
      return !customerHasAbsence && !equipmentHasAbsence;
    }).map((corpusCase) => corpusCase.id);

    expect(casesWithNoAbsence).toEqual([]);
  });

  it('formalises all eight official adversarial absence cases named in docs/ROADMAP.md, P4-S2', () => {
    const adversarialIds = [
      'voice-prompt-04',
      'voice-prompt-05',
      'voice-prompt-06',
      'voice-prompt-08',
      'voice-prompt-09',
      'voice-prompt-10',
      'installed-base-row-07',
      'installed-base-row-15',
    ];
    const presentIds = EXTRACTION_CORPUS.map((corpusCase) => corpusCase.id);
    for (const id of adversarialIds) {
      expect(presentIds).toContain(id);
    }
  });

  it('contains all ten official Voice Test Prompts', () => {
    const officialVoicePrompts = EXTRACTION_CORPUS.filter((corpusCase) =>
      corpusCase.origin.locator.startsWith('Voice Test Prompts sheet'),
    );
    expect(officialVoicePrompts).toHaveLength(10);

    const first = officialVoicePrompts.find((corpusCase) => corpusCase.id === 'voice-prompt-01');
    expect(first?.inputText).toBe(
      'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
    );
    const adversarial = officialVoicePrompts.find(
      (corpusCase) => corpusCase.id === 'voice-prompt-06',
    );
    expect(adversarial?.inputText).toBe(
      'Clinica DemoCare Andes has one very old CT and two MR systems from the same manufacturer.',
    );
  });
});

describe('extraction corpus: evaluator distinguishes Known / DeclaredUnknown / MustNotInfer', () => {
  it('passes a correct extraction', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-correct',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedCustomer: { name: known('Hospital Alpha') },
      expectedEquipment: [
        { modality: known('MR'), quantity: known(2), manufacturer: mustNotInfer() },
      ],
    };
    const actual = extraction({ name: 'Hospital Alpha' }, [equipmentGroup({ quantity: 2 })]);

    const result = evaluateCase(corpusCase, actual);
    expect(result.passed).toBe(true);
    expect(result.fields.every((field) => field.passed)).toBe(true);
  });

  it('identifies a fabricated value against MustNotInfer', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-fabricated',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedEquipment: [{ modality: known('MR'), manufacturer: mustNotInfer() }],
    };
    const actual = extraction({}, [equipmentGroup({ manufacturer: 'NovaMed' })]);

    const result = evaluateCase(corpusCase, actual);
    expect(result.passed).toBe(false);
    const manufacturerField = result.fields.find(
      (field) => field.scope === 'equipment[0].manufacturer',
    );
    expect(manufacturerField?.reason).toBe('fabricated-value');
  });

  it('passes a MustNotInfer approximateAge when the actual value is the unknown variant, not fabricated', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-age-must-not-infer',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedEquipment: [{ modality: known('MR'), approximateAge: mustNotInfer() }],
    };
    const actual = extraction({}, [equipmentGroup({ approximateAge: { type: 'unknown' } })]);

    const result = evaluateCase(corpusCase, actual);
    expect(result.passed).toBe(true);
    const ageField = result.fields.find((field) => field.scope === 'equipment[0].approximateAge');
    expect(ageField?.passed).toBe(true);
  });

  it('identifies a correctly recognised declared-unknown value', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-declared-unknown',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedEquipment: [{ modality: known('MR'), manufacturer: declaredUnknown() }],
    };
    const passingActual = extraction({}, [equipmentGroup({ manufacturer: null })]);
    const fabricatedActual = extraction({}, [equipmentGroup({ manufacturer: 'NovaMed' })]);

    const passing = evaluateCase(corpusCase, passingActual);
    const fabricated = evaluateCase(corpusCase, fabricatedActual);

    expect(passing.passed).toBe(true);
    expect(fabricated.passed).toBe(false);
    const fabricatedField = fabricated.fields.find(
      (field) => field.scope === 'equipment[0].manufacturer',
    );
    expect(fabricatedField?.reason).toBe('fabricated-value');
  });

  it('distinguishes wrong-value, missing-expected-value, wrong-normalization and wrong-follow-up', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-failure-modes',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedCustomer: { name: known('Hospital Alpha') },
      expectedEquipment: [
        {
          modality: known('CT'),
          quantity: known(2),
          approximateAge: known({ type: 'qualitative', label: 'old' }),
        },
      ],
      expectedFollowUps: [{ field: 'Manufacturer' }],
    };
    const actual: ActualExtractionResult = {
      extraction: {
        customer: { name: null, city: null, country: null },
        equipment: [
          equipmentGroup({
            modality: 'MR',
            quantity: 3,
            approximateAge: { type: 'exact', years: 5 },
          }),
        ],
      },
      followUps: [],
    };

    const result = evaluateCase(corpusCase, actual);
    expect(result.passed).toBe(false);

    const byScope = Object.fromEntries(result.fields.map((field) => [field.scope, field]));
    expect(byScope['customer.name']?.reason).toBe('missing-expected-value');
    expect(byScope['equipment[0].modality']?.reason).toBe('wrong-normalization');
    expect(byScope['equipment[0].quantity']?.reason).toBe('wrong-value');
    expect(byScope['equipment[0].approximateAge']?.reason).toBe('wrong-normalization');
    expect(byScope['follow-up:Manufacturer']?.reason).toBe('wrong-follow-up');
  });

  it('flags a declared-unknown field that gets asked again as a follow-up', () => {
    const corpusCase: CorpusCase = {
      id: 'sample-no-reask',
      origin: { source: 'project-authored', locator: 'test' },
      language: 'en',
      inputText: 'test',
      expectedEquipment: [{ modality: known('MR'), model: declaredUnknown() }],
    };
    const actual: ActualExtractionResult = {
      extraction: {
        customer: { name: null, city: null, country: null },
        equipment: [equipmentGroup({ model: null })],
      },
      followUps: [{ field: 'Model', priority: 'Optional' }],
    };

    const result = evaluateCase(corpusCase, actual);
    expect(result.passed).toBe(false);
    const followUpField = result.fields.find((field) => field.scope === 'follow-up:Model');
    expect(followUpField?.reason).toBe('wrong-follow-up');
  });
});
