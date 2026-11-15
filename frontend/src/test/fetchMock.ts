import { vi } from "vitest";

type Handler = (body: unknown) => unknown;

/**
 * Stubs global fetch with handlers keyed by "METHOD /path". A handler returns either a
 * plain JSON body (or a promise of one) (status 200) or { status: number, body }. Unmatched requests fail the test.
 */
export const mockFetch = (routes: Record<string, Handler>) => {
  const calls: { key: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) {
      throw new Error(`Unexpected request: ${key}`);
    }
    const result = (await handler(body)) as { status?: number; body?: unknown } | undefined;
    const isWrapped =
      result !== null &&
      typeof result === "object" &&
      typeof (result as { status?: unknown }).status === "number";
    const status = isWrapped ? (result as { status: number }).status : 200;
    const payload = isWrapped ? (result as { body?: unknown }).body : result;
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, routes };
};
