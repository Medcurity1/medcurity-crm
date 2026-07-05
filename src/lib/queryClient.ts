import { QueryClient, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { logClientError } from "./clientErrorLogger";

// Global telemetry for failed mutations. Fires for EVERY TanStack
// mutation that throws — local onError handlers continue to run and
// toast on their own. This handler exists purely so silent failures
// (network drop mid-save, RLS denial, rep navigates away before the
// promise rejects, missed toast) leave a server-side trail.
//
// We also emit a fallback toast when no local handler exists, so a
// mutation written without onError still surfaces to the user.

const mutationCache = new MutationCache({
  onError: (error, variables, _context, mutation) => {
    try {
      logClientError({
        mutationKey: mutation.options.mutationKey,
        error,
        payload: variables,
      });
    } catch {
      // never let logging break the app
    }

    // If the mutation didn't register a local onError, the user would
    // otherwise see nothing. Show a generic toast as a safety net.
    if (!mutation.options.onError) {
      const message =
        (error as { message?: string })?.message ?? "Save failed";
      toast.error("Save failed: " + message);
    }
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      // 30s: list/dashboard data that changes rarely doesn't refetch on nearly
      // every navigation. Freshness for records you just created/edited comes
      // from post-mutation invalidation (thorough across the app), which forces
      // an immediate refetch regardless of staleTime. Queries that genuinely
      // need fresher data override staleTime locally.
      staleTime: 30_000,
      retry: 1,
      // OFF (was true): refetch-on-focus made EVERY active query re-fire each
      // time you tab away and back — a lag spike + network flood on big lists.
      // Freshness now comes from the short staleTime (refetch on navigate) +
      // explicit post-mutation invalidation. Widgets that need live data set
      // their own refetchInterval.
      refetchOnWindowFocus: false,
    },
  },
});
