// Behavior assertions grouped by function; see README.md in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { storyFixture, storyResponse } from "../../support/fixtures/story-creation.mjs";
import { harness } from '../../support/fixtures/story-preparation-harness.mjs';


test("strict transport rejects duplicate JSON, extra authority fields, wrong/multiple tools and truncated output without repair", async () => {
  for (const mutate of [
    response => { const fn = response.choices[0].message.tool_calls[0].function; fn.arguments = fn.arguments.replace('"title":', '"title":"first","title":'); },
    response => { const fn = response.choices[0].message.tool_calls[0].function; const body = JSON.parse(fn.arguments); body.jobId = "forged"; fn.arguments = JSON.stringify(body); },
    response => { response.choices[0].message.tool_calls[0].function.name = "another_tool"; },
    response => { response.choices[0].message.tool_calls.push(response.choices[0].message.tool_calls[0]); },
    response => { response.choices[0].finish_reason = "length"; },
    response => { response.choices[0].message.content = "pretend this was accepted"; },
    response => { response.choices[0].message.tool_calls[0].function.arguments = { title: "object shortcut" }; },
  ]) {
    const f = storyFixture(), h = harness(f, { response: request => { const response = storyResponse(f.body, request.stage); mutate(response); return response; } });
    const result = await h.run(); assert.equal(result.code, "STORY_OUTPUT_INVALID"); assert.equal(h.calls.length, 1);
  }
});
