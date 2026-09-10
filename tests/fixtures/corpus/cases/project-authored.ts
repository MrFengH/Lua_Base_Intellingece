/**
 * Project-authored cases, explicitly labelled as such per docs/ROADMAP.md, P4-S1 ("No presentes
 * casos nuestros como oficiales"). All are transcribed verbatim from docs/TESTING.md's "Required
 * cases" table and "Project-authored reference cases" block, or from README.md's demo script,
 * neither of which is an official source. Fragments that lack a modality or quantity noun in
 * their original wording (docs/TESTING.md's own "input sketch" column) are transcribed exactly
 * as written, without adding words to make them self-contained; the corresponding expectation is
 * simply left unasserted rather than guessed.
 */
import type { CorpusCase } from '../types';
import { declaredUnknown, known, mustNotInfer } from '../types';

const testingOrigin = (locator: string) => ({
  source: 'project-authored' as const,
  locator: `TESTING.md, ${locator}`,
});
const readmeOrigin = (locator: string) => ({
  source: 'project-authored' as const,
  locator: `README.md, ${locator}`,
});

export const PROJECT_AUTHORED_CASES: readonly CorpusCase[] = [
  {
    id: 'project-authored-01',
    origin: testingOrigin('"Project-authored reference cases" block, case 1'),
    language: 'es',
    inputText: 'Había dos equipos NovaMed, creo que ambos eran resonadores.',
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(2),
        manufacturer: known('NovaMed'),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
        certainty: known('Uncertain'),
      },
    ],
    expectedFollowUps: [
      { field: 'CustomerName', priority: 'Required' },
      { field: 'Location', priority: 'Required' },
      { field: 'ApproximateAge' },
    ],
    notes:
      'TESTING.md records this as "2 x MR, manufacturer NovaMed, certainty Uncertain on ' +
      'modality." The extraction contract has one certainty per equipment group, not a ' +
      'per-field certainty, so the group-level certainty is asserted as Uncertain.',
  },
  {
    id: 'project-authored-02',
    origin: testingOrigin('"Project-authored reference cases" block, case 2'),
    language: 'es',
    inputText:
      'El equipo de Orion Imaging parecía viejo, quizá diez años, pero no pude ver el modelo.',
    expectedEquipment: [
      {
        quantity: known(1),
        manufacturer: known('Orion Imaging'),
        model: declaredUnknown(),
        approximateAge: known({ type: 'estimate', minYears: 10, maxYears: 10 }),
        certainty: known('Uncertain'),
      },
    ],
    notes:
      'TESTING.md itself calls this "unknown-or-stated modality" — the fragment never names one ' +
      '("el equipo" is generic) — so modality is left unasserted rather than guessed.',
  },
  {
    id: 'project-authored-03',
    origin: testingOrigin(
      '"Project-authored reference cases" block, case 3, and Required cases table row "Speaker self-corrects"',
    ),
    language: 'es',
    inputText: 'Primero pensé que eran tres, pero en realidad había dos.',
    expectedEquipment: [{ quantity: known(2), modality: mustNotInfer() }],
    notes:
      'Appears twice in TESTING.md (the reference-cases block and the required-cases table) and ' +
      'is transcribed once here. "En realidad" is also one of decision 17\'s self-correction ' +
      'phrases, but that decision governs merging two separate extraction calls inside one ' +
      'capture; this case tests something narrower and purely at the extraction layer — that a ' +
      'single utterance containing an in-sentence self-correction is read as quantity 2, not 3 ' +
      'and not both. No modality noun appears in the fragment, so its absence is asserted rather ' +
      'than a modality being guessed.',
  },
  {
    id: 'project-authored-04',
    origin: testingOrigin('Required cases table, row "Unknown manufacturer"'),
    language: 'es',
    inputText: 'un tomógrafo, no vi la marca',
    expectedEquipment: [
      {
        modality: known('CT'),
        quantity: known(1),
        manufacturer: declaredUnknown(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    notes:
      'Must never produce a brand inferred from context; "no vi la marca" is an explicit statement.',
  },
  {
    id: 'project-authored-05',
    origin: testingOrigin('Required cases table, row "Unknown model"'),
    language: 'es',
    inputText: 'un equipo de Orion Imaging, no pude ver el modelo',
    expectedEquipment: [
      {
        quantity: known(1),
        manufacturer: known('Orion Imaging'),
        model: declaredUnknown(),
        approximateAge: mustNotInfer(),
      },
    ],
    notes:
      'Must never produce a model name inferred from the brand. No modality noun appears in the ' +
      'fragment ("un equipo" is generic), so none is asserted.',
  },
  {
    id: 'project-authored-06',
    origin: testingOrigin('Required cases table, row "Several devices in one sentence"'),
    language: 'es',
    inputText: 'dos resonadores NovaMed y un tomógrafo Orion Imaging',
    expectedEquipment: [
      {
        label: 'MR',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: known('NovaMed'),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'CT',
        modality: known('CT'),
        quantity: known(1),
        manufacturer: known('Orion Imaging'),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    notes: 'Must never produce one merged group; two distinct modalities and two distinct brands.',
  },
  {
    id: 'project-authored-07',
    origin: testingOrigin('Required cases table, row "Differing ages, same modality"'),
    language: 'es',
    inputText: 'dos tienen unos nueve años y uno unos tres',
    expectedEquipment: [
      {
        label: 'the pair',
        quantity: known(2),
        approximateAge: known({ type: 'estimate', minYears: 9, maxYears: 9 }),
        certainty: known('Uncertain'),
        modality: mustNotInfer(),
      },
      {
        label: 'the single unit',
        quantity: known(1),
        approximateAge: known({ type: 'estimate', minYears: 3, maxYears: 3 }),
        certainty: known('Uncertain'),
        modality: mustNotInfer(),
      },
    ],
    notes:
      'Must never produce one group of three with an averaged age. The fragment as given in ' +
      'TESTING.md names no modality at all, so its absence is asserted on both groups rather ' +
      'than a modality being guessed.',
  },
  {
    id: 'project-authored-08',
    origin: testingOrigin('Required cases table, row "Ambiguous quantity"'),
    language: 'es',
    inputText: 'había varios ecógrafos',
    expectedEquipment: [
      {
        modality: known('Ultrasound'),
        quantity: mustNotInfer(),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Quantity', priority: 'Required' }],
    notes: 'Must never invent a specific number for "varios" (several).',
  },
  {
    id: 'project-authored-09',
    origin: testingOrigin('Required cases table, row "Approximate age"'),
    language: 'es',
    inputText: 'quizá unos ocho años',
    expectedEquipment: [
      {
        approximateAge: known({ type: 'estimate', minYears: 8, maxYears: 8 }),
        certainty: known('Uncertain'),
        modality: mustNotInfer(),
        quantity: mustNotInfer(),
      },
    ],
    notes:
      'Must never produce `{ type: "exact", years: 8 }`. The fragment names no modality or ' +
      'quantity, so their absence is asserted rather than either being guessed.',
  },
  {
    id: 'project-authored-10',
    origin: testingOrigin('Required cases table, row "Qualitative age"'),
    language: 'es',
    inputText: 'parece bastante nuevo',
    expectedEquipment: [
      {
        approximateAge: known({ type: 'qualitative', label: 'bastante nuevo' }),
        modality: mustNotInfer(),
        quantity: mustNotInfer(),
      },
    ],
    notes:
      'Must never produce any numeric age. The fragment names no modality or quantity, so their ' +
      'absence is asserted rather than either being guessed.',
  },
  {
    id: 'project-authored-11',
    origin: testingOrigin('Required cases table, row "Colloquial phrasing"'),
    language: 'es',
    inputText: 'tenían un par de máquinas de resonancia bastante viejas',
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'bastante viejas' }),
      },
    ],
    notes: 'Must never produce a numeric age from "viejas" (old).',
  },
  {
    id: 'project-authored-12',
    origin: readmeOrigin('"Duplicate detection" corroboration run, step 1 (Spanish)'),
    language: 'es',
    inputText: 'Estoy en el Hospital DemoCare Pacific, en Panama. Tienen dos resonadores.',
    expectedCustomer: { name: known('Hospital DemoCare Pacific'), country: known('Panama') },
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      "This is the demo's own Spanish opening line. README.md documents a development-mock-only " +
      'parsing trap around an accented "Panamá" versus plain-ASCII "Panama" for this exact ' +
      "sentence; that trap is specific to the deterministic mock's customer-matching logic, not " +
      'to extraction quality, so it is out of scope here and is not asserted as part of this ' +
      'corpus. Compare with project-authored-13 below.',
  },
  {
    id: 'project-authored-13',
    origin: readmeOrigin('"Demo path" step 2 (English)'),
    language: 'en',
    inputText:
      'I visited Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
    expectedCustomer: { name: known('Hospital DemoCare Pacific'), country: known('Panama') },
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
      'docs/TESTING.md\'s "English" required-case row describes this as "the same [sentence] in ' +
      'English" as its "Spanish" row (project-authored-12 here), but the two README sentences are ' +
      'not literal translations of each other: this one adds "and one CT" that the Spanish demo ' +
      'line omits. Both are transcribed verbatim from their respective README.md locations rather ' +
      'than silently reconciled into a matching pair.',
  },
];
