import type { PatientAgeCategory } from '../types/index.js';

export const PATIENT_AGE_CATEGORIES = [
  { value: 'children', label: 'Children', range: '0–12 years' },
  { value: 'adults', label: 'Adults', range: '13–59 years' },
  { value: 'senior_citizens', label: 'Senior Citizens', range: '60+ years' },
] as const satisfies ReadonlyArray<{
  value: PatientAgeCategory;
  label: string;
  range: string;
}>;

export function isPatientAgeCategory(value: unknown): value is PatientAgeCategory {
  return PATIENT_AGE_CATEGORIES.some((category) => category.value === value);
}

export function getAgeCategory(age: number): PatientAgeCategory | null {
  if (!Number.isInteger(age) || age < 0) return null;
  if (age <= 12) return 'children';
  if (age <= 59) return 'adults';
  return 'senior_citizens';
}

export function getAgeFromDateOfBirth(dateOfBirth: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;

  const birthDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.toISOString().slice(0, 10) !== dateOfBirth
  ) {
    return null;
  }

  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birthDate > todayDate) return null;

  let age = todayDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDifference = todayDate.getUTCMonth() - birthDate.getUTCMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && todayDate.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

export function getAgeCategoryLabel(category: PatientAgeCategory | undefined): string {
  return PATIENT_AGE_CATEGORIES.find((item) => item.value === category)?.label ?? 'Not selected';
}
