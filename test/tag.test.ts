import { test } from "node:test";
import assert from "node:assert/strict";
import { tagSpans, tagsIn } from "../src/core/tag";

// vault REF-tags.md 인식 규칙 표
test("tagsIn: 줄 시작·공백 뒤, 계층, 뒤 구두점", () => {
  assert.deepEqual(tagsIn("#캐시 본문 #성능/스캔 끝 #태그, #b."), ["캐시", "성능/스캔", "태그", "b"]);
});

test("tagsIn: 헤딩·숫자만·앞이 공백 아님·이스케이프는 태그 아님", () => {
  assert.deepEqual(tagsIn("# 제목\n#123\na#b (#x) http://h/#sec &#123; \\#x"), []);
});

test("tagsIn: 색 코드는 태그로 잡힌다", () => {
  assert.deepEqual(tagsIn("색 #fff"), ["fff"]);
});

test("tagsIn: 인라인 코드 안은 태그 아님", () => {
  assert.deepEqual(tagsIn("`#a` ``x #b`` #c"), ["c"]);
});

test("tagsIn: 펜스 코드 블록 안은 태그 아님 (``` ~~~)", () => {
  assert.deepEqual(tagsIn("```c\n#include\n```\n#a\n~~~\n#b\n~~~\n#c"), ["a", "c"]);
});

test("tagsIn: 닫는 펜스는 같은 문자·같거나 긴 길이·뒤에 공백만", () => {
  assert.deepEqual(tagsIn("````\n```\n#a\n```` x\n#b\n`````\n#c"), ["c"]);
});

test("tagsIn: 안 닫힌 펜스는 끝까지 코드", () => {
  assert.deepEqual(tagsIn("#a\n```\n#b"), ["a"]);
});

test("tagsIn: CRLF 본문", () => {
  assert.deepEqual(tagsIn("#a\r\n```\r\n#b\r\n```\r\n#c\r\n"), ["a", "c"]);
});

test("tagSpans: 위치는 원문 좌표", () => {
  const text = "x\r\n`#no` #yes/";
  assert.deepEqual(tagSpans(text), [{ start: 9, end: 13, tag: "yes" }]);
  assert.equal(text.slice(9, 13), "#yes");
});
