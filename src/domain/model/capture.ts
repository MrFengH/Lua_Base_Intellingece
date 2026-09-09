import type { ApproximateAge } from './age';
import type { CaptureState, FieldOrigin, Modality, ObservationSource } from './enums';

export type DraftField<T> =
  | { state: 'Missing' }
  | {
      state: 'Known';
      value: T;
      origin: FieldOrigin;
      evidenceIds: readonly string[];
    }
  | {
      state: 'DeclaredUnknown';
      evidenceIds: readonly string[];
    };

export const missingField = <T>(): DraftField<T> => ({ state: 'Missing' });

export const knownField = <T>(
  value: T,
  origin: FieldOrigin = 'Reported',
  evidenceIds: readonly string[] = [],
): DraftField<T> => ({ state: 'Known', value, origin, evidenceIds });

export const declaredUnknownField = <T>(evidenceIds: readonly string[] = []): DraftField<T> => ({
  state: 'DeclaredUnknown',
  evidenceIds,
});

export interface CaptureCustomerDraft {
  name: DraftField<string>;
  city: DraftField<string>;
  country: DraftField<string>;
}

export interface CaptureEquipmentDraft {
  id: string;
  order: number;
  modality: DraftField<Modality>;
  quantity: DraftField<number>;
  manufacturer: DraftField<string>;
  model: DraftField<string>;
  approximateAge: DraftField<ApproximateAge>;
  notes: DraftField<string>;
}

export interface CaptureDraft {
  id: string;
  state: CaptureState;
  source: ObservationSource;
  customer: CaptureCustomerDraft;
  equipment: readonly CaptureEquipmentDraft[];
  askedQuestionKeys: readonly string[];
}

export type FollowUpPriority = 'Required' | 'Preferred' | 'Optional';

export type FollowUpField =
  | 'CustomerName'
  | 'Location'
  | 'Modality'
  | 'Quantity'
  | 'Manufacturer'
  | 'ApproximateAge'
  | 'Model'
  | 'Notes';

export type FollowUpTarget =
  | { type: 'Customer' }
  | { type: 'Equipment'; equipmentGroupId: string }
  | { type: 'EquipmentCollection' };

export interface FollowUpQuestion {
  key: string;
  field: FollowUpField;
  priority: FollowUpPriority;
  target: FollowUpTarget;
  text: string;
}
