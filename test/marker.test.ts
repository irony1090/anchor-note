import { test } from "node:test";
import assert from "node:assert/strict";
import { closeMarkerText, markerText, markersIn, partialMarkerAt } from "../src/core/marker";

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

test("markerText: id가 있으면 `라벨#id`, markersIn으로 되읽힌다", () => {
  assert.equal(markerText("cache-scan", P), "@note:cache-scan");
  assert.equal(markerText("cache-scan", P, "fix"), "@note:cache-scan#fix");
  assert.deepEqual(markersIn(`// ${markerText("a", P, "x")}`, P), [{ label: "a", id: "x", start: 3, end: 12 }]);
});

test("markersIn: 닫는 마커 `@note:/라벨[#id]` (D26)", () => {
  assert.deepEqual(markersIn("// @note:/uart", P), [{ label: "uart", start: 3, end: 14, close: true }]);
  assert.deepEqual(markersIn("// @note:/uart#u1", P), [{ label: "uart", id: "u1", start: 3, end: 17, close: true }]);
});

test("markersIn: 여는·닫는 마커가 한 줄에", () => {
  assert.deepEqual(
    markersIn("/* @note:a */ x /* @note:/a */", P).map((hit) => [hit.label, hit.close === true]),
    [
      ["a", false],
      ["a", true],
    ],
  );
});

test("markersIn: `/` 뒤도 덩어리 전체가 유효해야", () => {
  for (const line of ["@note:/", "@note://a", "@note:/a/b", "@note:/a#", "@note:/a."]) {
    assert.deepEqual(markersIn(line, P), [], line);
  }
});

test("closeMarkerText: markersIn으로 되읽힌다", () => {
  assert.equal(closeMarkerText("a", P), "@note:/a");
  assert.equal(closeMarkerText("a", P, "x"), "@note:/a#x");
  assert.deepEqual(markersIn(`// ${closeMarkerText("a", P, "x")}`, P), [{ label: "a", id: "x", start: 3, end: 13, close: true }]);
});

test("partialMarkerAt: 닫는 마커 `/` 뒤는 자동완성 안 함", () => {
  assert.equal(partialMarkerAt("// @note:/ua", P), null);
});
