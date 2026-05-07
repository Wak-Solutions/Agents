import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";

export function useAuth() {
  const { data, isLoading, error } = useQuery({
    queryKey: [api.auth.me.path],
    queryFn: async () => {
      console.log("[use-auth] fetching /api/me");
      const res = await fetch(api.auth.me.path, { credentials: "include" });
      console.log("[use-auth] /api/me status:", res.status);
      if (res.status === 401) return { authenticated: false, role: undefined, agentId: null, agentName: undefined };
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[use-auth] /api/me error:", res.status, text);
        throw new Error("Failed to fetch auth state");
      }
      const json = await res.json();
      console.log("[use-auth] /api/me response:", json);
      return api.auth.me.responses[200].parse(json);
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    isAuthenticated: data?.authenticated ?? false,
    isLoading,
    error,
    role: data?.role ?? 'admin',
    agentId: data?.agentId ?? null,
    agentName: data?.agentName ?? 'Admin',
    isAdmin: (data?.role ?? 'admin') === 'admin',
    termsAcceptedAt: data?.termsAcceptedAt ?? null,
  };
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ identifier, password }: { identifier: string; password: string }) => {
      // Use apiRequest so the CSRF header is always included. Hitting fetch()
      // directly skipped the header and 403'd whenever a stale authed session
      // cookie survived from a prior login.
      let res: Response;
      try {
        res = await apiRequest(api.auth.login.method, api.auth.login.path, { email: identifier, password });
      } catch (err: any) {
        // apiRequest throws on non-2xx with the message "<status>: <body>".
        // Recover the status + body so we can preserve the existing error UX.
        const m = /^(\d+):\s*([\s\S]*)$/.exec(err?.message ?? '');
        const status = m ? Number(m[1]) : 0;
        const rawBody = m ? m[2] : '';
        let body: any = {};
        try { body = JSON.parse(rawBody); } catch { /* not JSON */ }
        if (status === 403) throw new Error(body.error || "Account deactivated");
        if (status === 402) throw new Error(body.message || "Your free trial has expired. Please contact support to continue.");
        throw new Error(body.message || "Invalid credentials");
      }
      return res.json();
    },
    onSuccess: (data) => {
      console.log("[use-auth] login success, setting cache:", data);
      queryClient.setQueryData([api.auth.me.path], {
        authenticated: true,
        role: data.role,
        agentId: data.agentId,
        agentName: data.agentName,
        termsAcceptedAt: data.termsAcceptedAt ?? null,
      });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(api.auth.logout.method, api.auth.logout.path);
      return api.auth.logout.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      // Set auth state to unauthenticated before clearing other queries.
      // This gives the Login page a cache hit on /api/me so it never
      // re-fires the request against the now-invalid session.
      queryClient.setQueryData([api.auth.me.path], {
        authenticated: false,
        role: undefined,
        agentId: null,
        agentName: undefined,
      });
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== api.auth.me.path,
      });
    },
  });
}
