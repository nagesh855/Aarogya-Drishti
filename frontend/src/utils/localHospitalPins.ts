export interface LocalHospitalPin {
  id: string;
  name: string;
  address: string;
  services: string[];
  latitude: number;
  longitude: number;
  createdAt: string;
}

export const LOCAL_HOSPITAL_PINS_STORAGE_KEY = 'aarogya-drishti:local-hospital-pins';

function isLocalHospitalPin(value: unknown): value is LocalHospitalPin {
  if (!value || typeof value !== 'object') return false;
  const pin = value as Record<string, unknown>;
  return (
    typeof pin.id === 'string' &&
    typeof pin.name === 'string' &&
    typeof pin.address === 'string' &&
    Array.isArray(pin.services) &&
    pin.services.every((service) => typeof service === 'string') &&
    typeof pin.latitude === 'number' &&
    Number.isFinite(pin.latitude) &&
    pin.latitude >= -90 &&
    pin.latitude <= 90 &&
    typeof pin.longitude === 'number' &&
    Number.isFinite(pin.longitude) &&
    pin.longitude >= -180 &&
    pin.longitude <= 180 &&
    typeof pin.createdAt === 'string'
  );
}

export function readLocalHospitalPins(): LocalHospitalPin[] {
  const stored = window.localStorage.getItem(LOCAL_HOSPITAL_PINS_STORAGE_KEY);
  if (!stored) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || !parsed.every(isLocalHospitalPin)) {
    throw new Error('Saved hospital map entries are invalid. Clear the corrupted browser storage and try again.');
  }
  return parsed;
}

export function saveLocalHospitalPins(pins: LocalHospitalPin[]): void {
  window.localStorage.setItem(LOCAL_HOSPITAL_PINS_STORAGE_KEY, JSON.stringify(pins));
}
