import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Message } from "@shared/schema";

export function useMessages(phone: string | null) {
  return useQuery({
    queryKey: ['messages', phone],
    queryFn: async () => {
      if (!phone) return [];
      const url = buildUrl(api.messages.list.path, { phone });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();
      return data as Message[];
    },
    enabled: !!phone,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ customer_phone, message }: { customer_phone: string, message: string }) => {
      const res = await fetch(api.messages.send.path, {
        method: api.messages.send.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_phone, message }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send message");
      const data = await res.json();
      return data as Message;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.customer_phone] });
      // ESCALATION — hidden for now
      // queryClient.invalidateQueries({ queryKey: [api.escalations.list.path] });
    },
  });
}
