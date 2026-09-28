import { test } from "node:test";
import assert from "node:assert/strict";
import { codeBlocks, duplicateBlockNames } from "../src/core/codeblock";

test("codeBlocks: lang·name·content·범위", () => {
  const text = "# t\n\n```c baud\n921600\n```\n";
  const [block] = codeBlocks(text);
  assert.deepEqual(block, { lang: "c", name: "baud", content: "921600\n", start: 15, end: 22, closed: true });
  assert.equal(text.slice(block.start, block.end), "921600\n");
});

test("codeBlocks: 여러 블록, 이름 없는 블록, info 없는 블록", () => {
  const blocks = codeBlocks("```c baud\n1\n```\n\n```sh\nx\n```\n\n```\ny\n```");
  assert.deepEqual(
    blocks.map((b) => [b.lang, b.name, b.content]),
    [
      ["c", "baud", "1\n"],
      ["sh", undefined, "x\n"],
      [undefined, undefined, "y\n"],
    ],
  );
});

test("codeBlocks: 라벨 규칙에 안 맞는 둘째 단어는 이름이 아니다", () => {
  const blocks = codeBlocks("```js a/b\n```\n```js {1,3}\n```\n```js x.\n```");
  assert.deepEqual(
    blocks.map((b) => b.name),
    [undefined, "{1,3}", undefined],
  );
});

test("codeBlocks: 여러 줄 내용, 빈 줄 보존", () => {
  const [block] = codeBlocks("~~~c init\na();\n\nb();\n~~~\n");
  assert.equal(block.content, "a();\n\nb();\n");
});

test("codeBlocks: 빈 블록은 start = end", () => {
  const text = "```c e\n```\n";
  const [block] = codeBlocks(text);
  assert.equal(block.content, "");
  assert.equal(block.start, 7);
  assert.equal(block.end, 7);
});

test("codeBlocks: 펜스 들여쓰기만큼 내용 앞 공백을 뗀다", () => {
  const [block] = codeBlocks("  ```c v\n  a\n    b\n c\n  ```");
  assert.equal(block.content, "a\n  b\nc\n");
});

test("codeBlocks: 안 닫힌 블록은 원문 끝까지", () => {
  const text = "```c v\na\nb\n";
  const [block] = codeBlocks(text);
  assert.deepEqual([block.content, block.closed, block.end], ["a\nb\n", false, text.length]);
});

test("codeBlocks: 안 닫힌 블록이 줄바꿈 없이 끝남", () => {
  const [block] = codeBlocks("```c v\na");
  assert.deepEqual([block.content, block.closed], ["a\n", false]);
});

test("codeBlocks: 여는 줄로 끝나는 원문", () => {
  const [block] = codeBlocks("```c v");
  assert.deepEqual([block.content, block.start, block.end, block.closed], ["", 6, 6, false]);
});

test("codeBlocks: CRLF 본문 — 내용은 \\n, 범위는 원문 좌표", () => {
  const text = "```c v\r\na\r\nb\r\n```\r\n";
  const [block] = codeBlocks(text);
  assert.equal(block.content, "a\nb\n");
  assert.equal(text.slice(block.start, block.end), "a\r\nb\r\n");
});

test("codeBlocks: 긴 펜스 안의 짧은 펜스는 내용", () => {
  const [block] = codeBlocks("````md doc\n```c x\n```\n````");
  assert.equal(block.name, "doc");
  assert.equal(block.content, "```c x\n```\n");
});

test("duplicateBlockNames: 겹친 이름만, 처음 나온 순서", () => {
  const blocks = codeBlocks("```c b\n```\n```c a\n```\n```c b\n```\n```c a\n```\n```c b\n```\n```sh\n```");
  assert.deepEqual(duplicateBlockNames(blocks), ["b", "a"]);
});
