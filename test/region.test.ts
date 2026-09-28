import { test } from "node:test";
import assert from "node:assert/strict";
import { regionsIn } from "../src/core/region";

const P = "@note:";
const brief = (lines: string[]) => {
  const { regions, issues } = regionsIn(lines, P);
  return {
    regions: regions.map((r) => [r.id === undefined ? r.label : `${r.label}#${r.id}`, r.open, r.close]),
    issues: issues.map((i) => [i.kind, i.line]),
  };
};

test("regionsIn: 여는·닫는 마커 사이가 범위", () => {
  assert.deepEqual(brief(["// @note:uart#u1", "a", "b", "// @note:/uart#u1"]), { regions: [["uart#u1", 0, 3]], issues: [] });
});

test("regionsIn: 닫는 마커 없는 여는 마커는 보통 마커 — 오류 아님", () => {
  assert.deepEqual(brief(["// @note:a", "x"]), { regions: [], issues: [] });
});

test("regionsIn: 빈 범위(바로 다음 줄에서 닫힘)도 범위", () => {
  assert.deepEqual(brief(["@note:a", "@note:/a"]), { regions: [["a", 0, 1]], issues: [] });
});

test("regionsIn: 앞선 여는 마커가 없는 닫는 마커는 orphan", () => {
  assert.deepEqual(brief(["@note:/a", "@note:a"]), { regions: [], issues: [["orphan", 0]] });
});

test("regionsIn: 같은 줄의 닫는 마커는 짝이 안 됨", () => {
  assert.deepEqual(brief(["/* @note:a */ x /* @note:/a */"]), { regions: [], issues: [["orphan", 0]] });
});

test("regionsIn: id가 다르면 짝이 아니다", () => {
  assert.deepEqual(brief(["@note:a#x", "@note:/a#y", "@note:/a"]), {
    regions: [],
    issues: [
      ["orphan", 1],
      ["orphan", 2],
    ],
  });
});

test("regionsIn: 가장 가까운 앞선 여는 마커와 짝", () => {
  assert.deepEqual(brief(["@note:a", "x", "@note:a", "y", "@note:/a"]), { regions: [["a", 2, 4]], issues: [] });
});

test("regionsIn: 한 번 닫힌 마커를 또 닫으면 orphan", () => {
  assert.deepEqual(brief(["@note:a", "@note:/a", "@note:/a"]), { regions: [["a", 0, 1]], issues: [["orphan", 2]] });
});

test("regionsIn: 나란한 범위 여럿", () => {
  assert.deepEqual(brief(["@note:a#1", "x", "@note:/a#1", "@note:b", "y", "@note:/b"]), {
    regions: [
      ["a#1", 0, 2],
      ["b", 3, 5],
    ],
    issues: [],
  });
});

test("regionsIn: 중첩은 바깥 범위가 overlap", () => {
  assert.deepEqual(brief(["@note:a", "@note:b", "x", "@note:/b", "@note:/a"]), {
    regions: [
      ["b", 1, 3],
      ["a", 0, 4],
    ],
    issues: [["overlap", 0]],
  });
});

test("regionsIn: 엇갈림은 둘 다 overlap", () => {
  assert.deepEqual(brief(["@note:a", "@note:b", "@note:/a", "@note:/b"]).issues, [
    ["overlap", 0],
    ["overlap", 1],
  ]);
});

test("regionsIn: 범위 안의 보통 마커는 overlap 아님 (범위 마커만 본다)", () => {
  assert.deepEqual(brief(["@note:a", "@note:other", "@note:/a"]).issues, []);
});
