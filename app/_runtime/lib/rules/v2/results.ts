import type {
  AuthoritativeWorldState,
  NeedsKpRulesResult,
  RejectedRulesResult,
  RuleDiagnostic,
  RulesRejectionCode,
} from "./model";
import { scopeOf } from "./events";

export function needsKp(
  state: AuthoritativeWorldState,
  diagnostics: RuleDiagnostic[],
): NeedsKpRulesResult {
  const scope = scopeOf([], [], []);
  return {
    kind: "needsKp",
    diagnostics: structuredClone(diagnostics),
    events: [],
    state,
    cache: state,
    scope,
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
