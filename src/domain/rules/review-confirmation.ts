/**
 * The observer's answer to the agent's closing "Is that correct?". Only an unambiguous yes is a
 * confirmation; anything else leaves the draft unconfirmed, because an approval that was never
 * given must never be assumed.
 */
export type ReviewConfirmationReply = 'Confirm' | 'Reject' | 'Unrelated';

const AFFIRMATIVE = String.raw`(?:s[ií]|yes|yeah|yep|correcto|correcta|es\s+correcto|es\s+correcta|as[ií]\s+es|exacto|exacta|confirmo|confirmado|confirm|confirmed|that(?:'|’)?s\s+correct|that\s+is\s+correct|correct|ok|okay|vale|de\s+acuerdo|perfecto|todo\s+correcto|est[aá]\s+bien|looks\s+good)`;

/**
 * A bare affirmative, optionally repeated as in "sí, es correcto". "Sí, pero eran tres" is a
 * correction rather than a confirmation and must fall through to extraction instead.
 */
const CONFIRM = new RegExp(String.raw`^${AFFIRMATIVE}(?:[,\s]+${AFFIRMATIVE})*[.!]*$`, 'iu');

const REJECT =
  /^(?:no|nope|no[,.!\s]+.*|incorrecto|incorrecta|es\s+incorrecto|no\s+es\s+correcto|not\s+correct|that(?:'|’)?s\s+wrong|that\s+is\s+wrong|wrong|est[aá]\s+mal)[.!]*$/iu;

export const classifyReviewConfirmationReply = (text: string): ReviewConfirmationReply => {
  const value = text.trim();
  if (REJECT.test(value)) return 'Reject';
  if (CONFIRM.test(value)) return 'Confirm';
  return 'Unrelated';
};
