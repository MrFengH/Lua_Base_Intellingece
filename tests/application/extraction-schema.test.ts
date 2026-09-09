import { describe, expect, it } from 'vitest';
import { ExtractedEquipmentSchema, ObservationExtractionSchema } from '@/application/contracts';

const validEquipment = {
  modality: 'MR',
  rawModality: 'resonador',
  quantity: 2,
  manufacturer: 'NovaMed',
  model: null,
  approximateAge: { type: 'estimate', minYears: 7, maxYears: 9 },
  notes: null,
  certainty: 'Uncertain',
} as const;

const validExtraction = {
  customer: {
    name: 'Hospital DemoCare Pacific',
    city: 'Panama City',
    country: 'Panama',
  },
  equipment: [validEquipment],
};

describe('ObservationExtractionSchema', () => {
  it('rejects an inverted age interval through the schema refinement', () => {
    const result = ObservationExtractionSchema.safeParse({
      ...validExtraction,
      equipment: [
        {
          ...validEquipment,
          approximateAge: { type: 'range', minYears: 9, maxYears: 7 },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'custom',
            path: ['equipment', 0, 'approximateAge', 'maxYears'],
          }),
        ]),
      );
    }
  });

  it('rejects a modality outside the declared vocabulary', () => {
    const result = ObservationExtractionSchema.safeParse({
      ...validExtraction,
      equipment: [{ ...validEquipment, modality: 'PET' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an extra equipment property under strict parsing', () => {
    const result = ExtractedEquipmentSchema.safeParse({
      ...validEquipment,
      inventedProperty: 'not allowed',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]),
      );
    }
  });

  it('parses a valid extraction', () => {
    const result = ObservationExtractionSchema.safeParse(validExtraction);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validExtraction);
  });

  it('keeps missing model certainty absent instead of defaulting it to Explicit', () => {
    const withoutCertainty = Object.fromEntries(
      Object.entries(validEquipment).filter(([key]) => key !== 'certainty'),
    );
    const result = ObservationExtractionSchema.parse({
      ...validExtraction,
      equipment: [withoutCertainty],
    });

    expect(result.equipment[0]?.certainty).toBeNull();
  });
});
