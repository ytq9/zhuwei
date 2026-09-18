/**
 * The two ways rules code throws on purpose (ADR 0029).
 *
 * RulesValidationError: the input, or the state it names, is not canonical.
 * The step boundary turns it into a generic rejection, so nothing private
 * leaks through the message. RulesInvariantError: a check that must hold
 * between a step and its own fold, or inside the authoritative state, failed.
 * It is never a rejection and propagates with its stack. Anything else that
 * escapes the rules module was not thrown on purpose and propagates too.
 */
export class RulesValidationError extends TypeError {}

export class RulesInvariantError extends TypeError {
  override readonly name = "RulesInvariantError";
}
