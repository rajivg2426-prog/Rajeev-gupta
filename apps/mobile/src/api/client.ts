import { API_URL } from "./config";
import type { ApiErrorBody } from "./types";
import { useSession } from "../state/session";

/** Any non-2xx response, or a network failure (status 0, code "NETWORK"). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  /** Field errors from a zod 422, or `details.errors`, flattened to messages. */
  get detailMessages(): string[] {
    const d = this.details as { errors?: { path?: string; message: string }[]; issues?: { message: string }[] } | undefined;
    return [...(d?.errors ?? []), ...(d?.issues ?? [])].map((e) => ("path" in e && e.path ? `${e.path}: ${e.message}` : e.message));
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** Headers every request carries. TODO(auth): replace x-user-id with a Bearer JWT. */
export function authHeaders(): Record<string, string> {
  return { "x-user-id": useSession.getState().userId ?? "" };
}

export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function send(method: Method, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json", ...authHeaders() };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, { code: "NETWORK", message: `Cannot reach the server at ${API_URL}. ${(e as Error).message ?? ""}`.trim() });
  }
  if (!res.ok) {
    let parsed: Partial<ApiErrorBody> & { issues?: unknown } = {};
    try {
      parsed = await res.json();
    } catch {
      // non-JSON error body
    }
    const details = parsed.details ?? (parsed.issues ? { issues: parsed.issues } : undefined);
    throw new ApiError(res.status, {
      code: parsed.code ?? `HTTP_${res.status}`,
      message: parsed.message ?? (parsed.issues ? "Some fields are not valid" : `Request failed (${res.status})`),
      details,
    });
  }
  return res;
}

export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function requestText(path: string): Promise<string> {
  const res = await send("GET", path);
  return res.text();
}
