import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Fires immediately when the page returns to the foreground
 * (visibilitychange: hidden → visible).
 *
 * Why this exists:
 *   iOS PWA and background browser tabs freeze JavaScript timers —
 *   setInterval and React Query's refetchInterval both stop running.
 *   When the user returns to the app, data is stale with no automatic
 *   catch-up. This hook fixes that by invalidating all active React Query
 *   caches and calling an optional manual-fetch callback the moment the
 *   page becomes visible again.
 *
 * Usage:
 *   // Pages that use React Query hooks only:
 *   useVisibilityRefetch();
 *
 *   // Pages that use manual fetch + setInterval:
 *   useVisibilityRefetch(fetchData);
 */
export function useVisibilityRefetch(onVisible?: () => void) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Invalidate all active queries — triggers an immediate refetch
      // for every query that currently has a subscriber (rendered component).
      queryClient.invalidateQueries();
      onVisible?.();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [queryClient, onVisible]);
}
