import { test } from "node:test";
import assert from "node:assert/strict";
import { blockValue, dedentLines, indentLines, locateSlot, pickContext, replaceSlot, slotHash } from "../src/core/slot";

const LINE = "uart_config_t cfg = { .baud_rate = 921600, .data_bits = 8 };";
const at = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length });

test("locateSlot: prefix 뒤 ~ 처음 나오는 suffix", () => {
  assert.deepEqual(locateSlot(LINE, { prefix: "rate = ", suffix: "," }), at(LINE, "921600"));
});

test("locateSlot: 빈 prefix = 범위 맨 앞, 빈 suffix = 범위 끝", () => {
  assert.deepEqual(locateSlot("abc", { prefix: "", suffix: "" }), { start: 0, end: 3 });
  assert.deepEqual(locateSlot("abc;", { prefix: "", suffix: ";" }), { start: 0, end: 3 });
  assert.deepEqual(locateSlot("x=1", { prefix: "=", suffix: "" }), { start: 2, end: 3 });
});

test("locateSlot: 못 찾음·여러 곳", () => {
  assert.equal(locateSlot(LINE, { prefix: "nope", suffix: "," }), "missing");
  assert.equal(locateSlot(LINE, { prefix: "rate = ", suffix: "!" }), "missing");
  assert.equal(locateSlot("f(1); f(2);", { prefix: "f(", suffix: ")" }), "ambiguous");
});

test("pickContext: 가장 짧은 유일 문맥 -> locateSlot으로 되찾힌다", () => {
  const span = at(LINE, "921600");
  const ctx = pickContext(LINE, span.start, span.end);
  // " "·"= "는 여러 곳에 맞아서 "e = "까지 늘어난다
  assert.deepEqual(ctx, { prefix: "e = ", suffix: "," });
  assert.deepEqual(locateSlot(LINE, ctx!), span);
});

test("pickContext: 겹치는 자리가 있으면 문맥을 늘린다", () => {
  const text = "f(1); f(2);";
  const ctx = pickContext(text, 8, 9); // "2"
  assert.deepEqual(ctx, { prefix: " f(", suffix: ")" });
  assert.deepEqual(locateSlot(text, ctx!), { start: 8, end: 9 });
});

test("pickContext: 범위 맨 앞·맨 끝이면 빈 문맥", () => {
  assert.deepEqual(pickContext("abc", 0, 3), { prefix: "", suffix: "" });
  assert.deepEqual(pickContext("abc;", 0, 3), { prefix: "", suffix: ";" });
});

test("pickContext: 빈 선택(삽입 자리)도 된다", () => {
  const text = "a(); b();";
  const ctx = pickContext(text, 4, 4);
  assert.ok(ctx !== null);
  assert.deepEqual(locateSlot(text, ctx!), { start: 4, end: 4 });
});

test("pickContext: 값 안에 suffix가 있으면 suffix를 늘린다", () => {
  const text = "x = a, b, c;";
  const ctx = pickContext(text, 4, 8); // "a, b"
  assert.ok(ctx !== null);
  assert.deepEqual(locateSlot(text, ctx!), { start: 4, end: 8 });
});

test("pickContext: 여러 줄 문맥", () => {
  const text = "a\nv\na\nv";
  const ctx = pickContext(text, 6, 7);
  assert.deepEqual(locateSlot(text, ctx!), { start: 6, end: 7 });
});

test("pickContext: 모든 자리에서 찾은 문맥은 같은 자리로 되찾힌다", () => {
  for (const text of ["aaaa", "abab;abab", "f(1); f(1);", "x\n  x\nx", ""]) {
    for (let start = 0; start <= text.length; start++) {
      for (let end = start; end <= text.length; end++) {
        const ctx = pickContext(text, start, end);
        if (ctx !== null) {
          assert.deepEqual(locateSlot(text, ctx), { start, end }, `${JSON.stringify(text)} ${start}-${end}`);
        }
      }
    }
  }
});

test("replaceSlot: 바꾸고 새 자리", () => {
  const r = replaceSlot(LINE, { prefix: "rate = ", suffix: "," }, "115200");
  assert.ok(typeof r !== "string");
  assert.equal(r.region, LINE.replace("921600", "115200"));
  assert.deepEqual(r.span, at(r.region, "115200"));
});

test("replaceSlot: 새 값이 suffix를 품으면 unsafe", () => {
  assert.equal(replaceSlot("f(1);", { prefix: "f(", suffix: ")" }, "g(2)"), "unsafe");
});

test("replaceSlot: 새 값이 prefix를 품으면 unsafe", () => {
  assert.equal(replaceSlot("f(1);", { prefix: "f(", suffix: ")" }, "1 + f(0"), "unsafe");
});

test("replaceSlot: 못 찾음·여러 곳은 그대로 돌려준다", () => {
  assert.equal(replaceSlot("x", { prefix: "q", suffix: "" }, "1"), "missing");
  assert.equal(replaceSlot("f(1); f(2);", { prefix: "f(", suffix: ")" }, "3"), "ambiguous");
});

test("dedentLines·indentLines: 여는 마커 들여쓰기로 왕복", () => {
  const block = "a();\n\n  b();\n";
  const lines = indentLines(block, "    ");
  assert.deepEqual(lines, ["    a();", "", "      b();"]);
  assert.equal(dedentLines(lines, "    "), blockValue(block));
});

test("dedentLines: 들여쓰기가 모자란 줄은 있는 만큼", () => {
  assert.equal(dedentLines(["    a", "  b", "c"], "    "), "a\nb\nc");
});

test("indentLines: 빈 블록은 줄 없음", () => {
  assert.deepEqual(indentLines("", "  "), []);
  assert.deepEqual(indentLines("\n", "  "), [""]);
});

test("slotHash: 8자리 hex, 내용이 같으면 같다", () => {
  assert.match(slotHash("921600"), /^[0-9a-f]{8}$/);
  assert.equal(slotHash("a"), slotHash("a"));
  assert.notEqual(slotHash("a"), slotHash("b"));
});
