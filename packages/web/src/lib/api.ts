export interface ApiSuccess<T> { success: true; data?: T; message?: string; }
export interface ApiError { success: false; error: string; }
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as ApiResponse<T>;
  if (!('success' in body) || body.success === false) {
    throw new Error(body && 'error' in body ? body.error : `HTTP ${res.status}`);
  }
  return (body.data ?? (body as unknown as T)) as T;
}

export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });

export const apiGet = <T = unknown>(path: string) => api<T>(path);
