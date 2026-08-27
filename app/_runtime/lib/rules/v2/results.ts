import type {
  AuthoritativeWorldState,
  NeedsKpRulesResult,
  RejectedRulesResult,
  RuleDiagnostic,
  RulesRejectionCode,
} from "./model";
import { createScopeProof } from "./events";
import { hashWorldState } from "./validation";

export function needsKp(
  state: AuthoritativeWorldState,
  diagnostics: RuleDiagnostic[],
): NeedsKpRulesResult {
  const scopeProof = createScopeProof(state, [], [], []);
  return {
    kind: "needsKp",
    diagnostics: structuredClone(diagnostics),
    events: [],
    state,
    cache: state,
    stateHash: hashWorldState(state),
    scopeProof,
  };
}

export function rejected(
  code: RulesRejectionCode,
  message: string,
  diagnostics?: RuleDiagnostic[],
): RejectedRulesResult {
  return {
    kind: "rejected",
    rejection: {
      code,
      message,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    },
    events: [],
  };
}
