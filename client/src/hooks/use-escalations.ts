// ESCALATION — hidden for now

// import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
// import { api } from "@shared/routes";
// import type { Escalation } from "@shared/schema";

// export function useEscalations() {
//   return useQuery({
//     queryKey: [api.escalations.list.path],
//     queryFn: async () => {
//       const res = await fetch(api.escalations.list.path, { credentials: "include" });
//       if (!res.ok) throw new Error("Failed to fetch escalations");
//       const data = await res.json();
//       return data as Escalation[];
//     },
//     refetchInterval: 30000, // Poll every 30 seconds
//   });
// }

// export function useCloseEscalation() {
//   const queryClient = useQueryClient();
//
//   return useMutation({
//     mutationFn: async (customer_phone: string) => {
//       const res = await fetch(api.escalations.close.path, {
//         method: api.escalations.close.method,
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ customer_phone }),
//         credentials: "include",
//       });
//       if (!res.ok) throw new Error("Failed to close conversation");
//       return api.escalations.close.responses[200].parse(await res.json());
//     },
//     onSuccess: () => {
//       queryClient.invalidateQueries({ queryKey: [api.escalations.list.path] });
//     },
//   });
// }
