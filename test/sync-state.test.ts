import { test } from "node:test";
import assert from "node:assert/strict";
import { codeBlocks } from "../src/core/codeblock";
import { slotHash } from "../src/core/slot";
import { adoptContent, blockEdit, classify, findBlock, findSlot, syncText, syncedHash } from "../src/core/sync-state";
import type { Slot } from "../src/core/sync-state";

const P = "@note:";

test("classify: 같음 / 메모만 바뀜 / 코드가 바뀜", () => {
  const hash = slotHash("9600");
  assert.equal(classify("9600", "9600", hash), "synced");
  assert.equal(classify("9600", "921600", hash), "pending");
  assert.equal(classify("115200", "921600", hash), "changed");
  // 양쪽 다 바뀜도 코드가 바뀜
  assert.equal(classify("115200", "9600", hash), "changed");
  // hash 없음("")은 어떤 슬롯과도 안 맞는다
  assert.equal(classify("9600", "921600", ""), "changed");
});

test("findBlock: 이름으로, 이름 없으면 블록이 하나일 때만", () => {
  const blocks = codeBlocks("```c a\n1\n```\n```c b\n2\n```\n```c b\n3\n```\n");
  assert.equal(findBlock(blocks, "a"), blocks[0]);
  assert.equal(findBlock(blocks, "b"), "duplicate");
  assert.equal(findBlock(blocks, "x"), "missing");
  assert.equal(findBlock(blocks, undefined), "missing");
  const one = codeBlocks("```\nonly\n```\n");
  assert.equal(findBlock(one, undefined), one[0]);
});

const FILE = [
  "void f() {",
  "    // @note:uart",
  "    uart_init();",
  "      set_pin(1); // @note:other",
  "    // @note:/uart",
  "    // @note:uart#u1",
  "    cfg = { .baud_rate = 9600, .bits = 8 };",
  "    // @note:/uart#u1",
  "}",
];

test("findSlot: 줄 단위 = 여는 마커 들여쓰기를 뗀 줄들, 안쪽 마커 수", () => {
  const slot = findSlot(FILE, P, "uart", undefined, { block: "init", hash: "" }) as Slot;
  assert.equal(slot.column, false);
  assert.equal(slot.text, "uart_init();\n  set_pin(1); // @note:other");
  assert.deepEqual([slot.from, slot.to], [{ line: 2, character: 0 }, { line: 4, character: 0 }]);
  assert.equal(slot.markers, 1);
});

test("findSlot: 열 단위 = 문맥 사이 글자와 파일 위치", () => {
  const slot = findSlot(FILE, P, "uart", "u1", { block: "baud", prefix: "e = ", suffix: ",", hash: "" }) as Slot;
  assert.equal(slot.column, true);
  assert.equal(slot.text, "9600");
  assert.deepEqual([slot.from, slot.to], [{ line: 6, character: 25 }, { line: 6, character: 29 }]);
  assert.equal(slot.markers, 0);
});

test("findSlot: 못 찾음 종류", () => {
  const link = { block: "baud", prefix: "e = ", suffix: ",", hash: "" };
  assert.equal(findSlot(FILE, P, "uart", "u9", link), "no-region");
  assert.equal(findSlot(FILE, P, "uart", "u1", { ...link, prefix: "rate: " }), "missing");
  assert.equal(findSlot(["// @note:a", "x, x,", "// @note:/a"], P, "a", undefined, { prefix: "x", suffix: ",", hash: "" }), "ambiguous");
  const overlap = ["// @note:a", "// @note:b", "// @note:/a", "// @note:/b"];
  assert.equal(findSlot(overlap, P, "a", undefined, { hash: "" }), "overlap");
});

test("syncText: 줄 단위는 들여쓴 줄들, 열 단위는 값. 반영 뒤 비교 값 = syncedHash 기준", () => {
  const lines = findSlot(FILE, P, "uart", undefined, { hash: "" }) as Slot;
  assert.equal(syncText(lines, { hash: "" }, "a();\n\n  b();\n"), "    a();\n\n      b();\n");
  assert.equal(syncText(lines, { hash: "" }, ""), "");

  const link = { prefix: "e = ", suffix: ",", hash: "" };
  const col = findSlot(FILE, P, "uart", "u1", link) as Slot;
  assert.equal(syncText(col, link, "921600\n"), "921600");
  // 값에 suffix가 들어가면 다음 찾기가 어긋난다
  assert.equal(syncText(col, link, "1, 2\n"), "unsafe");

  // 반영한 파일을 다시 읽으면 synced
  const next = [...FILE];
  next[6] = "    cfg = { .baud_rate = 921600, .bits = 8 };";
  const again = findSlot(next, P, "uart", "u1", link) as Slot;
  assert.equal(classify(again.text, "921600", syncedHash("921600\n")), "synced");
  assert.equal(slotHash(again.text), syncedHash("921600\n"));
});

test("adoptContent: 슬롯 -> 블록 내용, 빈 범위는 빈 블록", () => {
  assert.equal(adoptContent(findSlot(FILE, P, "uart", "u1", { prefix: "e = ", suffix: ",", hash: "" }) as Slot), "9600\n");
  assert.equal(adoptContent(findSlot(FILE, P, "uart", undefined, { hash: "" }) as Slot), "uart_init();\n  set_pin(1); // @note:other\n");
  assert.equal(adoptContent(findSlot(["// @note:a", "// @note:/a"], P, "a", undefined, { hash: "" }) as Slot), "");
  assert.equal(adoptContent(findSlot(["// @note:a", "", "// @note:/a"], P, "a", undefined, { hash: "" }) as Slot), "\n");
});

test("blockEdit: 내용 범위만, 펜스 들여쓰기와 줄바꿈 유지, 안 닫힌 블록은 거부", () => {
  const body = "- item\n  ```c baud\n  9600\n  ```\ntail\n";
  const [block] = codeBlocks(body);
  const edit = blockEdit(block, "921600\n\nx\n", "\n")!;
  assert.equal(`${body.slice(0, edit.start)}${edit.text}${body.slice(edit.end)}`, "- item\n  ```c baud\n  921600\n\n  x\n  ```\ntail\n");
  assert.equal(codeBlocks(`${body.slice(0, edit.start)}${edit.text}${body.slice(edit.end)}`)[0].content, "921600\n\nx\n");

  const crlf = "```c a\r\n1\r\n```\r\n";
  const [b] = codeBlocks(crlf);
  const e = blockEdit(b, "2\n3\n", "\r\n")!;
  assert.equal(`${crlf.slice(0, e.start)}${e.text}${crlf.slice(e.end)}`, "```c a\r\n2\r\n3\r\n```\r\n");

  assert.equal(blockEdit(codeBlocks("```c a\n1\n")[0], "2\n", "\n"), null);
  const empty = blockEdit(codeBlocks("```c a\n1\n```\n")[0], "", "\n")!;
  assert.equal(empty.text, "");
});
