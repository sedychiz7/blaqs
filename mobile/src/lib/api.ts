import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000';

const TOKEN_KEY = 'blaqs.session';
// AFTER_FIRST_UNLOCK so the background location task can authenticate while the phone is locked.
const storeOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken === undefined) cachedToken = await SecureStore.getItemAsync(TOKEN_KEY, storeOptions);
  return cachedToken;
}

export async function setToken(token: string | null) {
  cachedToken = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, storeOptions);
  else await SecureStore.deleteItemAsync(TOKEN_KEY, storeOptions);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }

  /** The server refused because of the free plan's limits. */
  get needsPremium() {
    return this.status === 402;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Please try again.');
  return data as T;
}
