import { test } from "node:test";
import assert from "node:assert/strict";
import { markerIssues } from "../src/core/marker-check";

const P = "@note:";
const brief = (lines: string[]) => markerIssues(lines, P).map(({ line, hit, kind, used }) => ({ line, marker: hit.id === undefined ? hit.label : `${hit.label}#${hit.id}`, kind, used }));

test("markerIssues: 규칙을 지키면 없음", () => {
  assert.deepEqual(markerIssues(["// @note:a", "// @note:a#x", "// @note:a#y", "// @note:b"], P), []);
});

test("markerIssues: id 없는 같은 라벨 — 둘째부터 bare, used는 파일 전체의 id", () => {
  assert.deepEqual(brief(["@note:a", "@note:a#fix", "@note:a", "@note:a#cause @note:a"]), [
    { line: 2, marker: "a", kind: "bare", used: ["fix", "cause"] },
    { line: 3, marker: "a", kind: "bare", used: ["fix", "cause"] },
  ]);
});

test("markerIssues: 같은 라벨·같은 id — 둘째부터 duplicate", () => {
  assert.deepEqual(brief(["@note:a#x", "@note:b#x", "@note:a#x"]), [{ line: 2, marker: "a#x", kind: "duplicate", used: ["x"] }]);
});

test("markerIssues: 라벨이 다르면 각자", () => {
  assert.deepEqual(markerIssues(["@note:a", "@note:b", "@note:ab"], P), []);
});

test("markerIssues: 위치는 마커 범위 (hit)", () => {
  const [issue] = markerIssues(["x @note:a", "y  @note:a"], P);
  assert.deepEqual(issue.hit, { label: "a", start: 3, end: 10 });
});

test("markerIssues: 닫는 마커는 D24 중복이 아니다", () => {
  assert.deepEqual(markerIssues(["// @note:a", "x", "// @note:/a", "// @note:b#i", "// @note:/b#i"], P), []);
});

test("markerIssues: 범위 오류 orphan·overlap을 줄 순서로 섞어 낸다", () => {
  assert.deepEqual(brief(["@note:/z", "@note:a", "@note:b#i", "@note:/a", "@note:/b#i", "@note:a"]), [
    { line: 0, marker: "z", kind: "orphan", used: [] },
    { line: 1, marker: "a", kind: "overlap", used: [] },
    { line: 2, marker: "b#i", kind: "overlap", used: [] },
    { line: 5, marker: "a", kind: "bare", used: [] },
  ]);
});
