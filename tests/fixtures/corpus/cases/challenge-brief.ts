/**
 * The four genuine examples from the official challenge brief
 * (`reference/Customer_Installed_Base_Intelligence_Hackathon_Challenge_v2 (1).docx`), quoted
 * verbatim from the extracted document text. See docs/GAP_ANALYSIS.md, the heading at
 * docs/TESTING.md:93-ish (`P1-S8`'s fix), for the earlier finding that these were once
 * misattributed as project-authored; here they carry their real origin.
 *
 * Two verbatim details worth flagging: the brief uses an en dash in "8–10 years" (not a
 * hyphen), and writes "São Paulo" with its accent. docs/TESTING.md's own quotation of the
 * second example drops the accent ("Sao Paulo") and TESTING.md's demo-sentence prose elsewhere
 * uses a hyphen for similar ranges — this corpus follows the brief itself as the higher-priority
 * source per AGENTS.md's source-priority rule, and flags the difference here rather than
 * silently reconciling it.
 */
import type { CorpusCase } from '../types';
import { known, mustNotInfer } from '../types';

const origin = (locator: string) => ({ source: 'challenge-brief' as const, locator });

export const CHALLENGE_BRIEF_CASES: readonly CorpusCase[] = [
  {
    id: 'challenge-brief-01',
    origin: origin('Challenge brief docx, "Your Mission" example (Hospital Alpha)'),
    language: 'en',
    inputText:
      'I visited Hospital Alpha today. They have three MR systems, two CT systems and four ' +
      'ultrasound systems. Two of the MR systems appear to be around 8–10 years old.',
    expectedCustomer: {
      name: known('Hospital Alpha'),
      city: mustNotInfer(),
      country: mustNotInfer(),
    },
    expectedEquipment: [
      {
        label: 'the two older MR systems',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'estimate', minYears: 8, maxYears: 10 }),
        certainty: known('Uncertain'),
      },
      {
        label: 'the third MR system',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'CT',
        modality: known('CT'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'ultrasound',
        modality: known('Ultrasound'),
        quantity: known(4),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [
      { field: 'Location', priority: 'Required' },
      { field: 'Manufacturer' },
      { field: 'ApproximateAge' },
    ],
    notes:
      'This is the brief\'s own canonical multi-modality example. "Two of the MR systems appear ' +
      'to be around 8-10 years old" describes only 2 of the 3 MR systems, so the correct ' +
      'grouping splits the MR total into a 2-unit aged group and a 1-unit group with no stated ' +
      'age — never one group of 3 with an averaged or otherwise invented age for the third. No ' +
      'city or country is stated for "Hospital Alpha" in this sentence.',
  },
  {
    id: 'challenge-brief-02',
    origin: origin('Challenge brief docx, "Conversational Data Capture" example (São Paulo)'),
    language: 'en',
    inputText:
      "I'm at Hospital Alpha in São Paulo. I saw two CT systems and three MR systems. " +
      'One of the MR systems looks relatively new.',
    expectedCustomer: {
      name: known('Hospital Alpha'),
      city: known('São Paulo'),
      country: mustNotInfer(),
    },
    expectedEquipment: [
      {
        label: 'CT',
        modality: known('CT'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
      {
        label: 'the newer MR system',
        modality: known('MR'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: known({ type: 'qualitative', label: 'relatively new' }),
      },
      {
        label: 'the other two MR systems',
        modality: known('MR'),
        quantity: known(2),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [{ field: 'Manufacturer' }, { field: 'ApproximateAge' }],
    notes:
      'Country is deliberately marked MustNotInfer even though São Paulo is a well-known ' +
      "Brazilian city: the sentence never states a country, and this project's schema is built " +
      'to extract only what was said, not to supply outside geographic knowledge. This is a ' +
      'stricter reading than some product philosophies might choose; it is recorded here as a ' +
      'deliberate, conservative test rather than an uncontroversial one. The MR total (3) splits ' +
      'the same way as challenge-brief-01, into the 1 unit described as newer and the remaining ' +
      '2 with no stated age.',
  },
  {
    id: 'challenge-brief-03',
    origin: origin(
      'Challenge brief docx, "AI-Powered Information Extraction" example ("There are three MR systems.")',
    ),
    language: 'en',
    inputText: 'There are three MR systems.',
    expectedCustomer: {
      name: mustNotInfer(),
      city: mustNotInfer(),
      country: mustNotInfer(),
    },
    expectedEquipment: [
      {
        modality: known('MR'),
        quantity: known(3),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [
      { field: 'CustomerName', priority: 'Required' },
      { field: 'Location', priority: 'Required' },
      { field: 'Manufacturer' },
      { field: 'ApproximateAge' },
    ],
    notes:
      'The brief itself introduces this line as the example of "gracefully handl[ing] ' +
      'incomplete information... without knowing the exact model or age." Taken as a standalone ' +
      'sentence it also names no facility at all, which is a real and useful test of the ' +
      "Required customer/location follow-ups, even though the brief's surrounding narrative " +
      'presumably assumes a facility already established in context.',
  },
  {
    id: 'challenge-brief-04',
    origin: origin('Challenge brief docx, "Intelligent Validation" follow-up dialogue'),
    language: 'en',
    inputText:
      "They have two CTs. I know one is approximately six years old, but I don't know the model.",
    expectedCustomer: {
      name: mustNotInfer(),
      city: mustNotInfer(),
      country: mustNotInfer(),
    },
    expectedEquipment: [
      {
        label: 'the CT described further',
        modality: known('CT'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        // model intentionally unasserted — see the note below.
        approximateAge: known({ type: 'estimate', minYears: 6, maxYears: 6 }),
        certainty: known('Uncertain'),
      },
      {
        label: 'the other CT',
        modality: known('CT'),
        quantity: known(1),
        manufacturer: mustNotInfer(),
        model: mustNotInfer(),
        approximateAge: mustNotInfer(),
      },
    ],
    expectedFollowUps: [
      { field: 'CustomerName', priority: 'Required' },
      { field: 'Location', priority: 'Required' },
      { field: 'Manufacturer' },
      { field: 'ApproximateAge' },
    ],
    notes:
      'The brief presents this as a two-turn exchange (assistant asks "Do you know the ' +
      'manufacturer or model?", user replies); this case concatenates the user\'s two lines only, ' +
      'omitting the assistant\'s own question, which is not something the observer said. "I ' +
      'don\'t know the model" is ambiguous between referring to the CT just described as six ' +
      'years old or to both CTs; this case takes the more literal reading (the unit just ' +
      'mentioned) and leaves the model expectation for that group intentionally unasserted ' +
      '(`undefined`) rather than guessing between DeclaredUnknown and MustNotInfer, since either ' +
      'reading is defensible. The second CT is left with no manufacturer, model or age ' +
      'expectation since nothing distinguishes it in the text.',
  },
];
