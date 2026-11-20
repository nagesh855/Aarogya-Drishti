const TOKEN_KEY = 'aarogya_drishti_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiRequest<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text || 'Unexpected server response' };
  }

  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
    );
  }

  return data as T;
}

export function authenticatedFileUrl(pathUrl: string): string {
  const token = getStoredToken();
  if (!token) return pathUrl;
  const separator = pathUrl.includes('?') ? '&' : '?';
  return `${pathUrl}${separator}token=${encodeURIComponent(token)}`;
}
