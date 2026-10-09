import type { z } from 'zod';
import { Problem } from '@ai-interview/shared';
import { accessToken } from '@/lib/supabase';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly expectedSeq?: number,
    readonly fieldErrors: { path: string; message: string }[] = [],
  ) {
    super(detail ?? title);
  }
}

type Opts = { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal; query?: Record<string, string | number | undefined> };

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function send(path: string, o: Opts): Promise<Response> {
  const qs = o.query
    ? '?' + new URLSearchParams(Object.entries(o.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : '';
  try {
    return await fetch(`${API_URL}/v1${path}${qs}`, {
      method: o.method ?? 'GET',
      signal: o.signal,
      headers: {
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
        ...(await authHeaders()),
      },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'internal', 'Cannot reach the server');
  }
}

async function toError(res: Response): Promise<ApiError> {
  const parsed = Problem.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return new ApiError(res.status, 'internal', `Request failed (${res.status})`);
  const p = parsed.data;
  return new ApiError(res.status, p.code, p.title, p.detail, p.expectedSeq, p.errors);
}

/** Validates the response against the shared schema so contract drift fails loudly at the boundary. */
export async function api<S extends z.ZodType>(path: string, schema: S, o: Opts = {}): Promise<z.infer<S>> {
  const res = await send(path, o);
  if (!res.ok) throw await toError(res);
  const json = await res.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(res.status, 'internal', 'Unexpected response from server', parsed.error.message);
  return parsed.data;
}

export async function apiVoid(path: string, o: Opts = {}): Promise<void> {
  const res = await send(path, o);
  if (!res.ok) throw await toError(res);
}

/** For endpoints that answer 200 with data or 202 with {status:"pending"}. Returns null while pending. */
export async function apiPoll<S extends z.ZodType>(path: string, schema: S, o: Opts = {}): Promise<z.infer<S> | null> {
  const res = await send(path, o);
  if (res.status === 202) return null;
  if (!res.ok) throw await toError(res);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'internal', 'Unexpected response from server', parsed.error.message);
  return parsed.data;
}

export const newIdempotencyKey = () => crypto.randomUUID();
