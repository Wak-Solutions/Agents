import { useQuery, useMutation } from "@tanstack/react-query";

export interface StatsPerDay {
  date: string;
  count: number;
}

export interface StatsData {
  totalCustomers: number;
  perDay: StatsPerDay[];
}

export function useStatistics(from: string, to: string) {
  return useQuery<StatsData>({
    queryKey: ["statistics", from, to],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/statistics?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch statistics");
      return res.json();
    },
    enabled: !!from && !!to,
    staleTime: 60_000,
  });
}

export function useAiSummary() {
  return useMutation<{ summary: string }, Error, { from: string; to: string }>({
    mutationFn: async ({ from, to }) => {
      const res = await fetch("/api/statistics/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message ?? "Failed to generate summary");
      }
      return res.json();
    },
  });
}
