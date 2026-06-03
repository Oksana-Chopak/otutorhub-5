import { useNavigate } from "react-router-dom";
import { OnboardingFlowB } from "@/components/OnboardingFlowB";

/**
 * Full-screen onboarding — Flow B: one step at a time, all actions inline.
 * Design: /design_handoff_onboarding_flowB/README.md
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  return <OnboardingFlowB onFinish={() => navigate("/")} />;
}
