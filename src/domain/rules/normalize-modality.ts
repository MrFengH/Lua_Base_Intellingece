import type { Modality } from '../model';

const NORMALIZED_MODALITIES = new Map<string, Modality>([
  ['mr', 'MR'],
  ['mri', 'MR'],
  ['magnetic resonance', 'MR'],
  ['resonancia', 'MR'],
  ['resonador', 'MR'],
  ['resonadores', 'MR'],
  ['ct', 'CT'],
  ['cat scan', 'CT'],
  ['computed tomography', 'CT'],
  ['tomografia', 'CT'],
  ['tomografo', 'CT'],
  ['tomografos', 'CT'],
  ['ultrasound', 'Ultrasound'],
  ['ultrasonido', 'Ultrasound'],
  ['ultrasonidos', 'Ultrasound'],
  ['x-ray', 'X-Ray'],
  ['xray', 'X-Ray'],
  ['rayos x', 'X-Ray'],
  ['patient monitoring', 'Patient Monitoring'],
  ['patient monitor', 'Patient Monitoring'],
  ['monitor de paciente', 'Patient Monitoring'],
  ['monitoreo de pacientes', 'Patient Monitoring'],
  ['unknown', 'Unknown'],
  ['desconocido', 'Unknown'],
]);

const normalizeToken = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase('en')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

/** Returns Unknown rather than guessing when a token is not an unambiguous synonym. */
export const normalizeModality = (value: string | null | undefined): Modality => {
  if (!value) return 'Unknown';
  return NORMALIZED_MODALITIES.get(normalizeToken(value)) ?? 'Unknown';
};
