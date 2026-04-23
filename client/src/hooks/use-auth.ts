import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";

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
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) throw new Error(body.error || "Account deactivated");
        if (res.status === 402) throw new Error(body.message || "Your free trial has expired. Please contact support to continue.");
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
      const res = await fetch(api.auth.logout.path, {
        method: api.auth.logout.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to logout");
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
