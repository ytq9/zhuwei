import { authoritativeKpProfileByModelId } from "./authoritative-policy";
import { assertDeepSeekStrictToolModelInput, deepSeekRequestBody } from "./deepseek";
import { assertOpenAIStrictToolModelInput, openAIRequestBody } from "./openai";

/** The journal and the actual transport freeze the same provider bytes. */
export function kpRequestBody(model: string, input: Record<string, unknown>): Record<string, unknown> {
  const provider = authoritativeKpProfileByModelId(model)?.provider;
  if (provider === "openai") return openAIRequestBody(model, input);
  if (provider === "deepseek") return deepSeekRequestBody(model, input);
  throw new TypeError("MODEL_PROFILE_UNAVAILABLE");
}

export function assertKpStrictToolModelInput(model: string, input: Record<string, unknown>): void {
  if (authoritativeKpProfileByModelId(model)?.provider === "openai") assertOpenAIStrictToolModelInput(input);
  else if (authoritativeKpProfileByModelId(model)?.provider === "deepseek") assertDeepSeekStrictToolModelInput(input);
  else throw new TypeError("MODEL_PROFILE_UNAVAILABLE");
}
