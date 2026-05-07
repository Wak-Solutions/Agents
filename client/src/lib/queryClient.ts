import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function getCsrfToken(): string {
  return (
    document.cookie
      .split('; ')
      .find((r) => r.startsWith('csrf-token='))
      ?.split('=')[1] ?? ''
  );
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isStateChanging = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(url, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(isStateChanging ? { "x-csrf-token": getCsrfToken() } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

/**
 * Drop-in replacement for `fetch()` that automatically attaches the CSRF
 * header on state-changing methods. Same return shape and same throwing
 * behaviour as `fetch` — does NOT throw on non-2xx, so call sites that
 * inspect `res.ok` / `res.status` keep working unchanged.
 *
 * Use this for any internal POST/PATCH/PUT/DELETE that goes through the
 * authenticated session. Public/webhook endpoints (CSRF-allowlisted) work
 * with this too — the extra header is harmless when the server doesn't
 * require it.
 */
export async function csrfFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isStateChanging = method !== 'GET' && method !== 'HEAD';
  const headers = new Headers(init.headers);
  if (isStateChanging && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', getCsrfToken());
  }
  return fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
