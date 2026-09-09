import { z } from 'zod';
import { MODALITIES } from '@/domain/model';

export const ApproximateAgeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exact'), years: z.number().nonnegative() }).strict(),
  z
    .object({
      type: z.literal('estimate'),
      minYears: z.number().nonnegative(),
      maxYears: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('range'),
      minYears: z.number().nonnegative(),
      maxYears: z.number().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal('qualitative'), label: z.string().min(1) }).strict(),
  z.object({ type: z.literal('unknown') }).strict(),
]);

export const ExtractedEquipmentSchema = z
  .object({
    modality: z.enum(MODALITIES),
    rawModality: z.string().min(1).nullable().default(null),
    quantity: z.number().int().positive().nullable(),
    manufacturer: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    approximateAge: ApproximateAgeSchema,
    notes: z.string().min(1).nullable().default(null),
    certainty: z.enum(['Explicit', 'Uncertain', 'Unknown']).default('Explicit'),
  })
  .strict();

export const ObservationExtractionSchema = z
  .object({
    customer: z
      .object({
        name: z.string().min(1).nullable(),
        city: z.string().min(1).nullable(),
        country: z.string().min(1).nullable(),
      })
      .strict(),
    equipment: z.array(ExtractedEquipmentSchema),
  })
  .strict()
  .superRefine((value, context) => {
    value.equipment.forEach((equipment, index) => {
      const age = equipment.approximateAge;
      if ((age.type === 'estimate' || age.type === 'range') && age.minYears > age.maxYears) {
        context.addIssue({
          code: 'custom',
          path: ['equipment', index, 'approximateAge', 'maxYears'],
          message: 'maxYears must be greater than or equal to minYears',
        });
      }
    });
  });

export type ObservationExtraction = z.infer<typeof ObservationExtractionSchema>;
export type ExtractedEquipment = z.infer<typeof ExtractedEquipmentSchema>;

// Reserved seam for the natural-language analytics stretch goal cited in the official challenge brief; intentionally unwired.
export const NaturalLanguageQueryIntentSchema = z
  .object({
    country: z.string().nullable(),
    modality: z.enum(MODALITIES).nullable(),
    minimumAgeYears: z.number().nonnegative().nullable(),
  })
  .strict();

export type NaturalLanguageQueryIntent = z.infer<typeof NaturalLanguageQueryIntentSchema>;
