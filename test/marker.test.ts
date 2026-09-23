import { test } from "node:test";
import assert from "node:assert/strict";
import { markerText, markersIn, partialMarkerAt } from "../src/core/marker";

const P = "@note:";

test("markersIn: id 없는 마커", () => {
  assert.deepEqual(markersIn("// @note:cache-scan", P), [{ label: "cache-scan", start: 3, end: 19 }]);
});

test("markersIn: id 있는 마커 — end는 id 끝까지", () => {
  assert.deepEqual(markersIn("// @note:cache-scan#fix", P), [{ label: "cache-scan", id: "fix", start: 3, end: 23 }]);
});

test("markersIn: 한 줄에 여러 마커", () => {
  assert.deepEqual(markersIn("@note:a x @note:b#y", P), [
    { label: "a", start: 0, end: 7 },
    { label: "b", id: "y", start: 10, end: 19 },
  ]);
});

test("markersIn: 덩어리 전체가 유효해야 마커 (D23 개정)", () => {
  const cases = [
    "@note:a#", // 빈 id
    "@note:#fix", // 빈 라벨
    "@note:a#b#c", // id에 #
    "@note:a#b.", // id 끝 마침표
    "@note:a.", // 문장 끝
    "`@note:a`", // 인용
    "@note:", // 라벨 없음
  ];
  for (const line of cases) {
    assert.deepEqual(markersIn(line, P), [], line);
  }
});

test("markersIn: 라벨이 앞부분만 겹치면 다른 라벨", () => {
  assert.deepEqual(
    markersIn("@note:ab", P).map((hit) => hit.label),
    ["ab"],
  );
});

test("markersIn: 공백에서 끊긴다 — `#`는 공백 뒤로 넘어가지 않는다", () => {
  assert.deepEqual(markersIn("@note:a #b", P), [{ label: "a", start: 0, end: 7 }]);
});

test("markersIn: prefix의 정규식 특수문자는 글자 그대로", () => {
  assert.deepEqual(markersIn("x @n.a", "@n."), [{ label: "a", start: 2, end: 6 }]);
  assert.deepEqual(markersIn("x @nXa", "@n."), []);
});

test("partialMarkerAt: 라벨을 쓰는 중", () => {
  assert.deepEqual(partialMarkerAt("// @note:cac", P), { start: 9, partial: "cac" });
  assert.deepEqual(partialMarkerAt("// @note:", P), { start: 9, partial: "" });
});

test("partialMarkerAt: `#` 뒤(id 입력 중)는 null", () => {
  assert.equal(partialMarkerAt("// @note:foo#", P), null);
  assert.equal(partialMarkerAt("// @note:foo#fi", P), null);
});

test("partialMarkerAt: prefix 없음·공백 뒤는 null", () => {
  assert.equal(partialMarkerAt("// note", P), null);
  assert.equal(partialMarkerAt("// @note:a b", P), null);
});

test("markerText", () => {
  assert.equal(markerText("cache-scan", P), "@note:cache-scan");
});
