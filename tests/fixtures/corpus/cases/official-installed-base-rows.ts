/**
 * The three "reusable" rows from the official workbook's "Dummy Installed Base" sheet named in
 * docs/ROADMAP.md, P4-S1 ("rows 7, 13 and 15 at minimum") — row numbers are the sheet's own data
 * rows (row 1 is the header), matching how docs/GAP_ANALYSIS.md cites them. Each row pairs a
 * `Voice Input Example` with a `Follow-up Question`/`Follow-up Answer`, i.e. a two-turn exchange,
 * not a single utterance. Since the P4-S1 harness evaluates one input text against one
 * extraction result, each case here concatenates the row's own Voice Input and Follow-up Answer
 * verbatim into one `inputText`, exactly as both were said — no wording is added or changed.
 */
import type { CorpusCase } from '../types';
import { declaredUnknown, known, mustNotInfer } from '../types';

const origin = (row: number, observationId: number) => ({
  source: 'official-workbook' as const,
  locator: `Dummy Installed Base sheet, row ${row} (Observation ID ${observationId})`,
});

export const OFFICIAL_INSTALLED_BASE_ROW_CASES: readonly CorpusCase[] = [
  {
    id: 'installed-base-row-07',
    origin: origin(7, 6),
    language: 'en',
    inputText:
      'They also have about five ultrasound systems. I think four are HelixCare; one is unknown.',
    expectedEquipment: [
      {
        modality: known('Ultrasound'),
        quantity: known(5),
        certainty: known('Uncertain'),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    notes:
      'This row continues an earlier turn in the same official conversation (row 5/6, Clinica ' +
      'DemoCare Light) — "They also have..." does not name the facility on its own, so this ' +
      'case makes no customer assertion. More importantly, "I think four are HelixCare; one is ' +
      'unknown" describes partial brand certainty *within* one quantity of five: the extraction ' +
      "contract's `ExtractedEquipment.manufacturer` is a single field per equipment group and " +
      'cannot represent "4 of 5 units are brand X, 1 unknown". Whether the correct behaviour is ' +
      'a single group with manufacturer left unresolved, a 4-and-1 split (by analogy with the ' +
      'heterogeneous-age splitting rule), or something else is not decided anywhere in the ' +
      'existing documentation, and this corpus deliberately does not invent a resolution — see ' +
      'docs/ROADMAP.md, P4-S1: "toma el material oficial como fuente de verdad; reporta la ' +
      'discrepancia; no inventes una reconciliación." Manufacturer is therefore left without an ' +
      'expectation here rather than asserted either way, and this gap should be resolved by a ' +
      'person before P4-S3 scores real-model output against this case. Model and age, by ' +
      'contrast, are never mentioned anywhere in this exchange, for either the four or the one, ' +
      'so asserting their absence is uncontroversial and does not touch the undecided split.',
  },
  {
    id: 'installed-base-row-13',
    origin: origin(13, 12),
    language: 'en',
    inputText:
      'Hospital DemoCare Park has one MR that looks around ten years old. HelixCare, model unknown.',
    expectedCustomer: { name: known('Hospital DemoCare Park') },
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(1),
        manufacturer: known('HelixCare'),
        model: declaredUnknown(),
        approximateAge: known({ type: 'estimate', minYears: 10, maxYears: 10 }),
        certainty: known('Uncertain'),
      },
    ],
    notes:
      'The workbook\'s own `Dummy Model` column names "HC-MR 300" for this row, while the same ' +
      'row\'s `Follow-up Answer` ("HelixCare, model unknown") and `Notes` ("Model not visible") ' +
      'say the opposite — a self-contradiction already recorded in docs/DECISIONS.md, decision ' +
      "9's amendment, which resolves it in favour of the structured column *for seeding the " +
      "database*, since reproducing the workbook is that slice's stated purpose. That resolution " +
      'does not apply here: this corpus asks what a fresh extraction of this exact wording ' +
      'should produce, and the wording unambiguously says the model was not seen. Expecting ' +
      '"HC-MR 300" here would make this corpus assert a fabrication as correct; expecting a ' +
      'declared-unknown model instead makes this row a genuine anti-fabrication test, and one ' +
      'that would specifically catch a model recalling "HC-MR 300" from having memorised the ' +
      'workbook rather than reading this input.',
  },
  {
    id: 'installed-base-row-15',
    origin: origin(15, 14),
    language: 'en',
    inputText:
      'Clinica DemoCare Central has many ultrasound systems, maybe eight. Aurelia Health. Eight is my best estimate.',
    expectedCustomer: { name: known('Clinica DemoCare Central') },
    expectedEquipment: [
      {
        modality: known('Ultrasound'),
        quantity: known(8),
        certainty: known('Uncertain'),
        manufacturer: known('Aurelia Health'),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    notes:
      'Adversarial (E-10): "Eight is my best estimate" is the clearest possible statement that a ' +
      'quantity, however precise it looks, must keep Uncertain certainty rather than becoming ' +
      "confident. The workbook's own spreadsheet columns separately record an age of 6 years for " +
      'this row, but neither the Voice Input Example nor the Follow-up Answer given here mentions ' +
      'an age at all, so this case does not expect one: a model has no textual basis to produce ' +
      "an age from this exchange, and importing the spreadsheet's age column into the extraction " +
      'expectation would itself be a kind of fabrication the corpus should not encode.',
  },
];
