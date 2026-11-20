import type { PatientProfile } from '../../../shared/types/index.js';

export function withoutAadhaarData(patient: PatientProfile): Omit<
  PatientProfile,
  'aadhaarLastFourEncrypted' | 'aadhaarNumberEncrypted' | 'aadhaarCardPhotoEncrypted'
> {
  const publicProfile: PatientProfile = { ...patient };
  delete publicProfile.aadhaarLastFourEncrypted;
  delete publicProfile.aadhaarNumberEncrypted;
  delete publicProfile.aadhaarCardPhotoEncrypted;
  return publicProfile;
}
