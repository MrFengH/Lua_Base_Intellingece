/**
 * The ten cases in the official workbook's "Voice Test Prompts" sheet
 * (`reference/Dummy_Installed_Base_Hackathon.xlsx`), transcribed verbatim from the sheet's
 * `Voice Input` column. `Expected Follow-up` and `Expected Structured Output` are the sheet's
 * own informal columns; each case below translates them into concrete, schema-level
 * expectations, grounded only in what the input text actually says. Where the sheet's informal
 * follow-up column asks to re-confirm or refine a value the input already stated (rather than
 * ask about something genuinely missing), this project's implemented follow-up logic does not
 * repeat the question — see docs/DECISIONS.md decision 16 and `FollowUpQuestionService` — so
 * that expectation is recorded in the case's `notes`, not asserted as a follow-up.
 */
import type { CorpusCase } from '../types';
import { known, declaredUnknown, mustNotInfer } from '../types';

const origin = (test: number) => ({
  source: 'official-workbook' as const,
  locator: `Voice Test Prompts sheet, Test #${test}`,
});

export const OFFICIAL_VOICE_PROMPT_CASES: readonly CorpusCase[] = [
  {
    id: 'voice-prompt-01',
    origin: origin(1),
    language: 'en',
    inputText: 'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
    expectedCustomer: {
      name: known('Hospital DemoCare Pacific'),
      country: known('Panama'),
    },
    expectedEquipment: [
      {
        label: 'MR',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'CT',
        modality: known('CT'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      'Sheet says "Ask brand and approximate age for each modality." City is not distinguished ' +
      'from country in this sentence ("in Panama"); this corpus does not assert a city here.',
  },
  {
    id: 'voice-prompt-02',
    origin: origin(2),
    language: 'en',
    inputText:
      'At Hospital DemoCare Horizon I saw three MR systems. Two seem old and one looks much newer.',
    expectedCustomer: { name: known('Hospital DemoCare Horizon') },
    expectedEquipment: [
      {
        label: 'older MR pair',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'old' }),
      },
      {
        label: 'newer MR',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'newer' }),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      'Exercises the same heterogeneous-age grouping rule as TESTING.md\'s "Differing ages, ' +
      'same modality" case: two MR groups, never one group of three with an averaged age. No ' +
      'numeric age is stated for either group ("old"/"newer" only), so both are qualitative and ' +
      'a numeric value for either is a fabrication. Compare with official Installed Base rows 3-4 ' +
      '(Hospital DemoCare Horizon), which describe the same facility and scenario with different ' +
      'wording and do carry official numeric ages (9 and 3 years) — a related but distinct case, ' +
      'not reused verbatim here.',
  },
  {
    id: 'voice-prompt-03',
    origin: origin(3),
    language: 'en',
    inputText:
      'Clinica DemoCare Light has two CT scanners, both Orion Imaging, around eleven years old.',
    expectedCustomer: { name: known('Clinica DemoCare Light') },
    expectedEquipment: [
      {
        modality: known('CT'),
        quantity: known(2),
        manufacturer: known('Orion Imaging'),
        model: mustNotInfer(),
        approximateAge: known({ type: 'estimate', minYears: 11, maxYears: 11 }),
        certainty: known('Uncertain'),
      },
    ],
    expectedFollowUps: [{ field: 'Model', priority: 'Optional' }],
    notes:
      '"Scanners" resolves to CT only because "CT scanners" states the modality in the same ' +
      'sentence; a bare "scanner" would stay Unknown per normalizeModality\'s documented rule. ' +
      '"Around eleven years" is hedged, so the age is an estimate with Uncertain certainty, ' +
      "never an exact 11 — consistent with decision 15's reasoning for the official seed. The " +
      'sheet\'s follow-up also asks to "confirm quantity", but quantity was already stated ' +
      'explicitly ("two"), so no Quantity follow-up is expected: a Known Required field is not ' +
      're-asked for confirmation.',
  },
  {
    id: 'voice-prompt-04',
    origin: origin(4),
    language: 'en',
    inputText: 'Centro Medico DemoCare Valley has one MR and two CTs. I do not know the brands.',
    expectedCustomer: { name: known('Centro Medico DemoCare Valley') },
    expectedEquipment: [
      {
        label: 'MR',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: declaredUnknown(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'CT pair',
        modality: known('CT'),
        quantity: known(2),
        manufacturer: declaredUnknown(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'ApproximateAge' }, { field: 'Model', priority: 'Optional' }],
    notes:
      'Adversarial (E-10): "I do not know the brands" is an explicit statement covering both ' +
      'groups, so manufacturer must be recognised as declared-unknown for each and never asked ' +
      'again — never a brand inferred from context, and never left as a plain missing field ' +
      'that keeps getting asked.',
  },
  {
    id: 'voice-prompt-05',
    origin: origin(5),
    language: 'en',
    inputText: 'Hospital DemoCare North has about six ultrasound units, mostly new.',
    expectedCustomer: { name: known('Hospital DemoCare North') },
    expectedEquipment: [
      {
        modality: known('Ultrasound'),
        quantity: known(6),
        certainty: known('Uncertain'),
        manufacturer: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'mostly new' }),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }],
    notes:
      'Adversarial (E-10): "about six" must keep Uncertain certainty rather than becoming a ' +
      'confident 6, and "mostly new" must stay qualitative, never a numeric age. The sheet\'s ' +
      'follow-up column also asks "what \'new\' means in years", but converting a qualitative ' +
      'answer into a number is exactly what AGENTS.md rule 10 and DATA_SCHEMA.md forbid, so no ' +
      'ApproximateAge follow-up is expected here; this is a documented divergence from the ' +
      "sheet's literal follow-up text, not an oversight.",
  },
  {
    id: 'voice-prompt-06',
    origin: origin(6),
    language: 'en',
    inputText:
      'Clinica DemoCare Andes has one very old CT and two MR systems from the same manufacturer.',
    expectedCustomer: { name: known('Clinica DemoCare Andes') },
    expectedEquipment: [
      {
        label: 'CT',
        modality: known('CT'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'very old' }),
      },
      {
        label: 'MR pair',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      'Adversarial (E-10): "from the same manufacturer" is anaphora with no antecedent — no ' +
      'brand is named anywhere in this sentence, for the CT or the MR pair — so manufacturer ' +
      'must stay null for both groups rather than being resolved to any brand. Contrast with ' +
      'official Installed Base row 11 (Clinica DemoCare Andes, same phrase), which is a later ' +
      'turn in the same conversation where a follow-up answer actually supplies "Orion Imaging"; ' +
      'that is a different case (installed-base-row family), not reused here.',
  },
  {
    id: 'voice-prompt-07',
    origin: origin(7),
    language: 'en',
    inputText: 'Hospital DemoCare Park has one MR, maybe ten years old, plus three CT scanners.',
    expectedCustomer: { name: known('Hospital DemoCare Park') },
    expectedEquipment: [
      {
        label: 'MR',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'estimate', minYears: 10, maxYears: 10 }),
        certainty: known('Uncertain'),
      },
      {
        label: 'CT trio',
        modality: known('CT'),
        quantity: known(3),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      'This is one of the cleaner prompts: the sheet\'s own follow-up ("Ask brand for both and ' +
      'CT age") matches the implemented Required/Preferred behaviour exactly, since the MR age ' +
      'is already known and only the CT age and both brands are genuinely missing.',
  },
  {
    id: 'voice-prompt-08',
    origin: origin(8),
    language: 'en',
    inputText:
      'Clinica DemoCare Central has many ultrasound systems, maybe eight, all Aurelia Health.',
    expectedCustomer: { name: known('Clinica DemoCare Central') },
    expectedEquipment: [
      {
        modality: known('Ultrasound'),
        quantity: known(8),
        certainty: known('Uncertain'),
        manufacturer: known('Aurelia Health'),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'ApproximateAge' }],
    notes:
      'Adversarial (E-10): "maybe eight" must never become a confident quantity of 8 — the ' +
      'certainty on this group must stay Uncertain even though the number itself looks precise. ' +
      'The sheet\'s follow-up ("ask confidence in quantity and age") again asks to re-confirm an ' +
      'already-stated quantity, which this corpus does not expect as a follow-up; only age is ' +
      'genuinely unmentioned.',
  },
  {
    id: 'voice-prompt-09',
    origin: origin(9),
    language: 'en',
    inputText: 'Instituto DemoCare Lima has two old CTs and one recently installed MR.',
    expectedCustomer: { name: known('Instituto DemoCare Lima') },
    expectedEquipment: [
      {
        label: 'CT pair',
        modality: known('CT'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'old' }),
      },
      {
        label: 'MR',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'recently installed' }),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }],
    notes:
      'Adversarial (E-10): qualitative ages in both directions ("old" and "recently installed"), ' +
      "neither ever becoming a number. The sheet's follow-up asks to refine both ages, which " +
      'this corpus does not expect as a follow-up since both are already Known qualitative ' +
      'values, consistent with the divergence noted on voice-prompt-05 and voice-prompt-08.',
  },
  {
    id: 'voice-prompt-10',
    origin: origin(10),
    language: 'en',
    inputText:
      'Hospital DemoCare Metro North has two MR systems. I know the brand is Aurelia Health but not the model.',
    expectedCustomer: { name: known('Hospital DemoCare Metro North') },
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(2),
        manufacturer: known('Aurelia Health'),
        model: declaredUnknown(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'ApproximateAge' }],
    notes:
      'Adversarial (E-10): the model must never be inferred from the brand "Aurelia Health". ' +
      'The sheet\'s own follow-up says "accept unknown model", which matches this project\'s ' +
      'declared-unknown behaviour exactly — model is not expected as a follow-up.',
  },
];
