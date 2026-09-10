export const MODALITIES = [
  'MR',
  'CT',
  'Ultrasound',
  'X-Ray',
  'Patient Monitoring',
  'Image Guided Therapy',
  'Unknown',
] as const;

export type Modality = (typeof MODALITIES)[number];

export const OBSERVATION_SOURCES = ['Text', 'Voice', 'Photo'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const OBSERVATION_STATUSES = ['Confirmed', 'Reported', 'Estimated', 'Unknown'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low', 'Unknown'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CAPTURE_STATES = [
  'NEW',
  'EXTRACTING',
  'NEEDS_FOLLOW_UP',
  'READY_FOR_REVIEW',
  'SAVED',
  'ERROR',
] as const;
export type CaptureState = (typeof CAPTURE_STATES)[number];

export const KNOWLEDGE_STATES = ['Missing', 'Known', 'DeclaredUnknown'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const FIELD_ORIGINS = ['Observed', 'Reported', 'Derived', 'Unknown'] as const;
export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

export const FACT_CERTAINTIES = ['Explicit', 'Uncertain', 'Unknown'] as const;
export type FactCertainty = (typeof FACT_CERTAINTIES)[number];

export const DUPLICATE_RESOLUTIONS = [
  'Unresolved',
  'NotDuplicate',
  'SameEquipment',
  'CorroboratingEvidence',
] as const;
export type DuplicateResolution = (typeof DUPLICATE_RESOLUTIONS)[number];

export const RESOLVED_DUPLICATE_RESOLUTIONS = [
  'NotDuplicate',
  'SameEquipment',
  'CorroboratingEvidence',
] as const satisfies readonly DuplicateResolution[];
export type ResolvedDuplicateResolution = (typeof RESOLVED_DUPLICATE_RESOLUTIONS)[number];

export const EVIDENCE_RELATIONSHIPS = [
  'NoMatch',
  'PossibleDuplicate',
  'PossibleCorroboration',
  'PartialMatch',
  'PossibleConflict',
] as const;
export type EvidenceRelationship = (typeof EVIDENCE_RELATIONSHIPS)[number];

/**
 * How the observer came to know what they are reporting. It is the provenance of the account,
 * not the precision of any field: a directly observed system may still have an uncertain age.
 */
export const OBSERVATION_BASES = ['DirectObservation', 'ReportedByOther', 'Estimate'] as const;
export type ObservationBasis = (typeof OBSERVATION_BASES)[number];
