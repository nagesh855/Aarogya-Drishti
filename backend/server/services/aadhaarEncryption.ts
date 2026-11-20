import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const AES_256_KEY_BYTES = 32;

export function getAadhaarEncryptionKey(): Buffer | null {
  const configuredKey = process.env.AADHAAR_ENCRYPTION_KEY?.trim();
  if (!configuredKey) return null;

  if (/^[0-9a-fA-F]{64}$/.test(configuredKey)) {
    return Buffer.from(configuredKey, 'hex');
  }

  const key = Buffer.from(configuredKey, 'base64');
  return key.length === AES_256_KEY_BYTES && key.toString('base64') === configuredKey
    ? key
    : null;
}

export function encryptAadhaarValue(value: string | Buffer, key: Buffer): string {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error('Aadhaar encryption requires a 32-byte key.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(typeof value === 'string' ? Buffer.from(value, 'utf8') : value),
    cipher.final(),
  ]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptAadhaarValue(value: string, key: Buffer): Buffer {
  if (key.length !== AES_256_KEY_BYTES) {
    throw new Error('Aadhaar decryption requires a 32-byte key.');
  }
  const [version, encodedIv, encodedAuthTag, encodedData, ...extra] = value.split(':');
  if (
    version !== 'v1' ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedData ||
    extra.length > 0
  ) {
    throw new Error('Stored Aadhaar value has an invalid encrypted format.');
  }
  const iv = Buffer.from(encodedIv, 'base64');
  const authTag = Buffer.from(encodedAuthTag, 'base64');
  const encrypted = Buffer.from(encodedData, 'base64');
  if (
    iv.length !== 12 ||
    authTag.length !== 16 ||
    iv.toString('base64') !== encodedIv ||
    authTag.toString('base64') !== encodedAuthTag ||
    encrypted.toString('base64') !== encodedData
  ) {
    throw new Error('Stored Aadhaar value has invalid encryption data.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
