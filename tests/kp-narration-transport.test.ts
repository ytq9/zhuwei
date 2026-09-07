import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { DEEPSEEK_API_KEY: "test-only-narration-transport-key" },
}));

import { authoritativeKpModelBinding } from "../app/_runtime/lib/kp/provider";
import { AUTHORITATIVE_KP_PROFILE, kpStructuredOutputMode } from "../app/_runtime/lib/kp/authoritative-policy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("routes ordinary generation and explicitly strict review per request under the default profile", async () => {
  const generationResponse = { fixture: "generation" };
  const reviewResponse = { fixture: "review" };
  // Install before binding construction: both real transports capture fetch.
  // No request can leave the test, and only the mocked env supplies a key.
  const interceptedFetch = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(generationResponse))
    .mockResolvedValueOnce(Response.json(reviewResponse));
  vi.stubGlobal("fetch", interceptedFetch);
  expect(kpStructuredOutputMode(AUTHORITATIVE_KP_PROFILE)).toBe("tool");
  const binding = authoritativeKpModelBinding(AUTHORITATIVE_KP_PROFILE);
  const generationSignal = new AbortController().signal;
  const reviewSignal = new AbortController().signal;
  const generation = {
    messages: [{ role: "user", content: "表达已提交结果。" }],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" }, max_completion_tokens: 800,
  };
  const review = {
    messages: [{ role: "user", content: "审核候选表达。" }],
    tools: [{ type: "function", function: {
      name: "review_frozen_narration", strict: true,
      parameters: { type: "object", properties: { assessment: { type: "string", enum: ["pass", "fail"] } },
        required: ["assessment"], additionalProperties: false },
    } }],
    tool_choice: "required", parallel_tool_calls: false,
    thinking: { type: "disabled" }, max_completion_tokens: 8192,
  };

  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, generation, { signal: generationSignal }))
    .resolves.toEqual(generationResponse);
  expect(interceptedFetch).toHaveBeenCalledTimes(1);
  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, review, { signal: reviewSignal }))
    .resolves.toEqual(reviewResponse);
  expect(interceptedFetch).toHaveBeenCalledTimes(2);

  const [ordinaryCall, strictCall] = interceptedFetch.mock.calls;
  expect(ordinaryCall![0]).toBe("https://api.deepseek.com/chat/completions");
  expect(strictCall![0]).toBe("https://api.deepseek.com/beta/chat/completions");
  expect(ordinaryCall![1]?.signal).toBe(generationSignal);
  expect(strictCall![1]?.signal).toBe(reviewSignal);
  for (const [, init] of [ordinaryCall!, strictCall!]) {
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-only-narration-transport-key");
  }
  expect(JSON.parse(String(ordinaryCall![1]?.body))).toMatchObject({
    model: AUTHORITATIVE_KP_PROFILE.modelId, response_format: { type: "json_object" }, max_tokens: 800,
  });
  expect(JSON.parse(String(strictCall![1]?.body))).toMatchObject({
    model: AUTHORITATIVE_KP_PROFILE.modelId, tool_choice: "required", max_tokens: 8192,
    tools: [{ function: { name: "review_frozen_narration", strict: true } }],
  });
});
