import { useAgentProviderStatus } from "./useAgentProviderStatus";
import type { DefaultProviderReadiness } from "../defaultProviderReadiness";
import { getBuildFeatureState } from "@/shared/profile/buildProfile";

/** An empty readiness set during startup is not evidence that setup is missing. */
export function useProviderSetupRequired(
  status: DefaultProviderReadiness["status"] | undefined,
): boolean {
  const { readyAgentIds, hasConfirmedReport } = useAgentProviderStatus();
  return (
    getBuildFeatureState().byoKeyProviders &&
    status === "needs_setup" &&
    hasConfirmedReport &&
    ![...readyAgentIds].some((id) => id !== "goose")
  );
}
