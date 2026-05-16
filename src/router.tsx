import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const MAX_LEAD_DETAIL_ENTRIES = 50;

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 10 * 60_000, // 10 minutes
      },
    },
  });

  // Cap lead-detail cache to MAX_LEAD_DETAIL_ENTRIES (evict LRU).
  if (typeof window !== "undefined") {
    queryClient.getQueryCache().subscribe(() => {
      const all = queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "lead-detail");
      if (all.length <= MAX_LEAD_DETAIL_ENTRIES) return;
      all
        .sort((a, b) => (a.state.dataUpdatedAt ?? 0) - (b.state.dataUpdatedAt ?? 0))
        .slice(0, all.length - MAX_LEAD_DETAIL_ENTRIES)
        .forEach((q) => queryClient.getQueryCache().remove(q));
    });
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
