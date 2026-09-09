import { describe, expect, it } from 'vitest';
import { MODALITIES } from '@/domain';
import type { Modality } from '@/domain';
import {
  createDevelopmentSeed,
  LocalSqliteDatabase,
  OFFICIAL_INSTALLED_BASE_RECORDS,
  SqliteInstalledBaseRepository,
  applyDevelopmentSeed,
} from '@/infrastructure';

const NOW = '2026-09-09T00:00:00.000Z';

/** The six fictional brands on the workbook's `Dummy Reference Lists` sheet. */
const OFFICIAL_BRANDS = [
  'NovaMed',
  'Aurelia Health',
  'BluePeak Medical',
  'Orion Imaging',
  'HelixCare',
  'Zenith MedTech',
];

/** The 13 facilities of the `Dummy Installed Base` sheet, in workbook row order. */
const OFFICIAL_CUSTOMERS = [
  'Hospital DemoCare Pacific',
  'Hospital DemoCare Horizon',
  'Clinica DemoCare Light',
  'Centro Medico DemoCare Valley',
  'Hospital DemoCare North',
  'Clinica DemoCare Andes',
  'Hospital DemoCare Park',
  'Clinica DemoCare Central',
  'Hospital DemoCare Pines',
  'Instituto DemoCare Lima',
  'Hospital DemoCare Green',
  'Centro Diagnostico DemoCare Caribbean',
  'Hospital DemoCare Metro North',
];

const seed = () => createDevelopmentSeed();
const allEquipment = () => seed().flatMap((aggregate) => aggregate.equipment);

const seeded = () => {
  const database = new LocalSqliteDatabase(':memory:');
  const repository = new SqliteInstalledBaseRepository(database);
  applyDevelopmentSeed(repository);
  return { database, repository };
};

describe('official workbook seed', () => {
  it('carries the 20 official records as 13 visits over 13 facilities', () => {
    const aggregates = seed();
    expect(OFFICIAL_INSTALLED_BASE_RECORDS).toHaveLength(20);
    expect(allEquipment()).toHaveLength(20);
    expect(aggregates).toHaveLength(13);
    expect(aggregates.map((aggregate) => aggregate.customer.name)).toEqual(OFFICIAL_CUSTOMERS);
    expect(new Set(aggregates.map((aggregate) => aggregate.customer.city)).size).toBe(13);
    expect(new Set(aggregates.map((aggregate) => aggregate.customer.country)).size).toBe(10);
  });

  it('uses only the official fictional brands, and all six of them', () => {
    const seeded = new Set(allEquipment().map((item) => item.manufacturer));
    expect([...seeded].sort()).toEqual([...OFFICIAL_BRANDS].sort());
  });

  it('uses the supported modality vocabulary and adds nothing the workbook does not contain', () => {
    const seeded = new Set(allEquipment().map((item) => item.modality));
    seeded.forEach((modality) => expect(MODALITIES).toContain(modality));
    // The installed-base sheet only ever uses these three. `Image Guided Therapy`, `X-Ray` and
    // `Patient Monitoring` are on the official reference list and are supported by the domain,
    // but no official record uses them, so none may appear in the seed.
    expect([...seeded].sort()).toEqual(['CT', 'MR', 'Ultrasound']);
    const unused: Modality[] = ['Image Guided Therapy', 'X-Ray', 'Patient Monitoring'];
    unused.forEach((modality) => {
      expect(MODALITIES).toContain(modality);
      expect(seeded.has(modality)).toBe(false);
    });
  });

  it('stores an official integer age as estimate(n, n) and never as an exact age', () => {
    allEquipment().forEach((item) => {
      expect(item.approximateAge.type).toBe('estimate');
    });
    const byId = new Map(allEquipment().map((item) => [item.id, item]));
    OFFICIAL_INSTALLED_BASE_RECORDS.forEach((record) => {
      const item = byId.get(`seed-equipment-${String(record.observationId).padStart(2, '0')}`);
      expect(item?.approximateAge).toEqual({
        type: 'estimate',
        minYears: record.approximateAgeYears,
        maxYears: record.approximateAgeYears,
      });
    });
  });

  it('derives every installation year to the official Estimated Installation Year', () => {
    const byId = new Map(allEquipment().map((item) => [item.id, item]));
    OFFICIAL_INSTALLED_BASE_RECORDS.forEach((record) => {
      const estimate = byId.get(
        `seed-equipment-${String(record.observationId).padStart(2, '0')}`,
      )?.installationEstimate;
      expect(estimate).toMatchObject({
        type: 'year',
        year: record.estimatedInstallationYear,
        origin: 'Derived',
        // An estimated age can only ever produce an estimated installation year.
        precision: 'Estimated',
      });
    });
  });

  it('leaves values the workbook does not supply unknown rather than filling them', () => {
    allEquipment().forEach((item) => {
      // The workbook gives a confidence level and no score. A number here would be invented.
      expect(item.confidence.score).toBeNull();
      expect(['High', 'Medium']).toContain(item.confidence.level);
      // The age was reported and hedged, so it must not be recorded as an explicit fact.
      expect(item.fieldProvenance.approximateAge?.certainty).toBe('Uncertain');
    });
  });

  it('transcribes quantity, brand, model, status, confidence and notes verbatim', () => {
    const byId = new Map(allEquipment().map((item) => [item.id, item]));
    OFFICIAL_INSTALLED_BASE_RECORDS.forEach((record) => {
      const item = byId.get(`seed-equipment-${String(record.observationId).padStart(2, '0')}`);
      expect(item).toMatchObject({
        modality: record.modality,
        quantity: record.quantity,
        manufacturer: record.brand,
        model: record.model,
        status: record.status,
        notes: record.notes,
      });
      expect(item?.confidence.level).toBe(record.confidence);
    });
  });

  it('records every visit as Voice evidence, as the official Source column says', () => {
    seed().forEach((aggregate) => {
      aggregate.session.evidence.forEach((evidence) => expect(evidence.source).toBe('Voice'));
    });
  });
});

describe('official seed through the projections', () => {
  it('gives Customer 360 the official facility, its equipment and its evidence', () => {
    const { database, repository } = seeded();
    try {
      const view = repository.getCustomer360('seed-customer-democare', NOW);
      expect(view?.customer.name).toBe('Hospital DemoCare Pacific');
      expect(view?.customer.city).toBe('Panama City');
      expect(view?.customer.country).toBe('Panama');
      expect(
        view?.installedBase.map((item) => [item.modality, item.quantity, item.manufacturer]),
      ).toEqual([
        ['MR', 2, 'NovaMed'],
        ['CT', 1, 'Aurelia Health'],
      ]);
      expect(view?.evidence.length).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it('keeps the two Horizon MR groups apart instead of averaging them', () => {
    const { database, repository } = seeded();
    try {
      const horizon = repository
        .listCustomers()
        .find((customer) => customer.name === 'Hospital DemoCare Horizon');
      const view = repository.getCustomer360(horizon?.id ?? '', NOW);
      const mr = view?.installedBase.filter((item) => item.modality === 'MR') ?? [];
      expect(mr).toHaveLength(2);
      expect(mr.map((item) => item.model).sort()).toEqual(['BP-MR 500', 'BP-MR 900']);
      expect(mr.map((item) => item.quantity).sort()).toEqual([1, 3]);
    } finally {
      database.close();
    }
  });

  it('aggregates the whole official dataset on the Dashboard', () => {
    const { database, repository } = seeded();
    try {
      const dashboard = repository.getDashboard(NOW);
      expect(dashboard.totalCustomers).toBe(13);
      expect(Object.keys(dashboard.observationsByCountry)).toHaveLength(10);
      expect(dashboard.equipmentByModality).toEqual({ MR: 15, CT: 12, Ultrasound: 23 });
      expect(dashboard.totalEquipmentObserved).toBe(50);
      // Every official row supplies modality, quantity, brand, model and an age.
      expect(dashboard.incompleteObservations).toBe(0);
      // No freshness policy was supplied, and the official data does not imply one.
      expect(dashboard.agingEquipment).toBeNull();
      expect(dashboard.agingPolicy).toBe('Not configured');
    } finally {
      database.close();
    }
  });

  it('does not retain the pre-official invented facilities', () => {
    const { database, repository } = seeded();
    try {
      const names = repository.list().map((customer) => customer.name);
      expect(names).not.toContain('Hospital São Aurora');
      expect(names).not.toContain('Hospital Valle Norte');
      expect(names.sort()).toEqual([...OFFICIAL_CUSTOMERS].sort());
    } finally {
      database.close();
    }
  });
});
