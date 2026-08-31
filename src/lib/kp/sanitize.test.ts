import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMetaHeavy,
  naturalFallback,
  stripMetaTalk,
} from "./sanitize.ts";

describe("stripMetaTalk", () => {
  it("drops protocol sentences and keeps the in-world line", () => {
    const raw = `你说："lian你好"

莉安·黑橡说："我听见了，但这不表示我确认了你的说法。"

NPC 的回应已作为 SourceClaim 记录；它不是 CanonicalFact。

对方作出了一个已明确归属于自己的口头回应。`;
    const out = stripMetaTalk(raw);
    assert.ok(!/SourceClaim/.test(out));
    assert.ok(!/CanonicalFact/.test(out));
    assert.ok(!/^你说/.test(out.trim()));
    assert.ok(!/明确归属于/.test(out));
  });

  it("flags premise handshake as meta", () => {
    const raw =
      "你的角色前提已确立：来意；requester=一位暮烛镇的老熟人，objective=赫斯·黑橡的死讯。";
    assert.equal(isMetaHeavy(raw), true);
    assert.equal(stripMetaTalk(raw), "");
  });

  it("answers what-do-I-know in human Chinese", () => {
    const t = naturalFallback("阿石", "我知道些什么");
    assert.match(t, /老熟人/);
    assert.ok(!/requester/.test(t));
    assert.ok(!/SourceClaim/.test(t));
  });

  it("greets Lian in-character", () => {
    const t = naturalFallback("阿石", "lian你好");
    assert.match(t, /莉安/);
    assert.match(t, /名字/);
    assert.ok(!/确认了你的说法/.test(t));
  });
});
