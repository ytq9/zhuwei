import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { DEEPSEEK_API_KEY: "test-only-narration-transport-key" },
}));

import { authoritativeKpModelBinding } from "../app/_runtime/lib/kp/provider";
import { AUTHORITATIVE_KP_PROFILE, kpStructuredOutputMode } from "../app/_runtime/lib/kp/authoritative-policy";
import { createSubmitKpProposalBundleModelInput, createVNextProposalOfferModelInput } from "../app/_runtime/lib/kp/vnext/proposal-schema";

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

it("routes actual vNext selection and amendable proposal tools through strict transport", async () => {
  const interceptedFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ fixture: "vnext" }));
  vi.stubGlobal("fetch", interceptedFetch);
  const binding = authoritativeKpModelBinding(AUTHORITATIVE_KP_PROFILE);
  const message = "在原地观察当前对象。";
  const inputs = [
    createVNextProposalOfferModelInput(message),
    createSubmitKpProposalBundleModelInput(message, ["observe"]),
    createSubmitKpProposalBundleModelInput(message, ["observe"], undefined, undefined, undefined,
      undefined, undefined, undefined, true),
  ];
  expect(inputs.map(input => input.tools.length)).toEqual([1, 1, 2]);
  for (const input of inputs) {
    await binding.run(AUTHORITATIVE_KP_PROFILE.modelId, input);
    const [url, init] = interceptedFetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.deepseek.com/beta/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toEqual(input.tools);
    expect(body.tool_choice).toBe("required");
    expect(body.max_tokens).toBe(4000);
  }
  expect(interceptedFetch).toHaveBeenCalledTimes(3);
});

it("rejects a malformed vNext strict tool pair before dispatch instead of falling back to ordinary transport", async () => {
  const interceptedFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ fixture: "unexpected" }));
  vi.stubGlobal("fetch", interceptedFetch);
  const binding = authoritativeKpModelBinding(AUTHORITATIVE_KP_PROFILE);
  const input = createSubmitKpProposalBundleModelInput("观察当前对象。", ["observe"], undefined, undefined,
    undefined, undefined, undefined, undefined, true);
  const malformed = { ...input, tools: input.tools.map((tool, index) => index === 1
    ? { ...tool, function: { ...tool.function, strict: false } } : tool) };
  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, malformed))
    .rejects.toMatchObject({ code: "strict_tool_configuration_invalid" });
  expect(interceptedFetch).not.toHaveBeenCalled();
});
