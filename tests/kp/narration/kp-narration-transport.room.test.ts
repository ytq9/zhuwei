import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { DEEPSEEK_API_KEY: "test-only-narration-transport-key" },
}));

import { authoritativeKpModelBinding } from "../../../app/_runtime/lib/kp/provider";
import { AUTHORITATIVE_KP_PROFILE, kpStructuredOutputMode } from "../../../app/_runtime/lib/kp/authoritative-policy";
import { createCorrectKpProposalBundleModelInput, createSubmitKpProposalBundleModelInput, createVNextProposalOfferModelInput } from "../../../app/_runtime/lib/kp/vnext/proposal-schema";
import { naturalNarrationModelInput, narrationReviewModelInput } from "../../../app/_runtime/lib/kp/narration-vnext";
import { transfer } from "../../support/fixtures/narration.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("routes actual frozen narration generation and review through strict transport", async () => {
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
  const request = transfer();
  const generation = naturalNarrationModelInput(request);
  const review = narrationReviewModelInput(request, "远行者把两面玻璃镜递给了药师。");

  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, generation, { signal: generationSignal }))
    .resolves.toEqual(generationResponse);
  expect(interceptedFetch).toHaveBeenCalledTimes(1);
  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, review, { signal: reviewSignal }))
    .resolves.toEqual(reviewResponse);
  expect(interceptedFetch).toHaveBeenCalledTimes(2);

  const [generationCall, reviewCall] = interceptedFetch.mock.calls;
  expect(generationCall![1]?.signal).toBe(generationSignal);
  expect(reviewCall![1]?.signal).toBe(reviewSignal);
  for (const [url, init] of [generationCall!, reviewCall!]) {
    expect(url).toBe("https://api.deepseek.com/beta/chat/completions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-only-narration-transport-key");
    const body = JSON.parse(String(init?.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.tool_choice).toBe("required");
    expect(body.parallel_tool_calls).toBe(false);
  }
  expect(JSON.parse(String(generationCall![1]?.body))).toMatchObject({
    model: AUTHORITATIVE_KP_PROFILE.modelId, max_tokens: generation.max_completion_tokens,
    tools: [{ function: { name: "submit_frozen_narration", strict: true } }],
  });
  expect(JSON.parse(String(reviewCall![1]?.body))).toMatchObject({
    model: AUTHORITATIVE_KP_PROFILE.modelId, tool_choice: "required", max_tokens: 8192,
    tools: [{ function: { name: "review_frozen_narration", strict: true } }],
  });
});

it("routes actual vNext selection, amendable proposal and draft revision tools through strict transport", async () => {
  const interceptedFetch = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ fixture: "vnext" }));
  vi.stubGlobal("fetch", interceptedFetch);
  const binding = authoritativeKpModelBinding(AUTHORITATIVE_KP_PROFILE);
  const message = "在原地观察当前对象。";
  const inputs = [
    createVNextProposalOfferModelInput(message),
    createSubmitKpProposalBundleModelInput(message, ["observe"]),
    createSubmitKpProposalBundleModelInput(message, ["observe"], undefined, undefined, undefined,
      undefined, undefined, undefined, true),
    createCorrectKpProposalBundleModelInput(message, [{ call: { id: "call_1", name: "submit_kp_proposal_bundle", arguments: "{}" }, content: "", body: "{}" }], ["observe"]),
  ];
  // The correction carries the filling form first and the correction tool after it.
  expect(inputs.map(input => input.tools.length)).toEqual([1, 1, 2, 2]);
  for (const input of inputs) {
    await binding.run(AUTHORITATIVE_KP_PROFILE.modelId, input);
    const [url, init] = interceptedFetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.deepseek.com/beta/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.tools).toEqual(input.tools);
    expect(body.messages).toEqual(input.messages);
    expect(body.tool_choice).toBe("required");
    expect(body.max_tokens).toBe(4000);
  }
  expect(interceptedFetch).toHaveBeenCalledTimes(4);
});

it.each([0, 1])("rejects a mixed vNext tool pair with non-strict tool %i before dispatch", async nonStrictIndex => {
  const interceptedFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ fixture: "unexpected" }));
  vi.stubGlobal("fetch", interceptedFetch);
  const binding = authoritativeKpModelBinding(AUTHORITATIVE_KP_PROFILE);
  const input = createSubmitKpProposalBundleModelInput("观察当前对象。", ["observe"], undefined, undefined,
    undefined, undefined, undefined, undefined, true);
  const malformed = { ...input, tools: input.tools.map((tool, index) => index === nonStrictIndex
    ? { ...tool, function: { ...tool.function, strict: false } } : tool) };
  await expect(binding.run(AUTHORITATIVE_KP_PROFILE.modelId, malformed))
    .rejects.toMatchObject({ code: "strict_tool_configuration_invalid",
      message: `DeepSeek strict-tool request is invalid: tools-${nonStrictIndex}-strict-required.` });
  expect(interceptedFetch).not.toHaveBeenCalled();
});
