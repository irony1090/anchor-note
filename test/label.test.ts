import { test } from "node:test";
import assert from "node:assert/strict";
import { isLabelChars, isValidLabel, toLabel } from "../src/core/label";

test("isValidLabel: 쓸 수 있는 라벨", () => {
  for (const label of ["cache-scan", "한글_라벨", "a.b", "v1.2_fix"]) {
    assert.equal(isValidLabel(label), true, label);
  }
});

test("isValidLabel: 빈 값·끝 마침표", () => {
  assert.equal(isValidLabel(""), false);
  assert.equal(isValidLabel("a."), false);
});

test("isValidLabel: 공백 (D22 라벨 공백 금지) — 탭·전각 공백 포함", () => {
  for (const label of ["a b", "a\tb", "a　b"]) {
    assert.equal(isValidLabel(label), false, JSON.stringify(label));
  }
});

test("isValidLabel: 파일명 금지 문자·백틱·제어문자", () => {
  for (const ch of ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "`", "\u0001"]) {
    assert.equal(isValidLabel(`a${ch}b`), false, JSON.stringify(ch));
  }
});

test("isValidLabel: `#` 금지 (D24 마커 id)", () => {
  assert.equal(isValidLabel("a#b"), false);
  assert.equal(isValidLabel("#a"), false);
});

test("isLabelChars: 쓰다 만 라벨은 통과, 금지 문자는 거부", () => {
  assert.equal(isLabelChars(""), true);
  assert.equal(isLabelChars("a."), true);
  assert.equal(isLabelChars("a#"), false);
  assert.equal(isLabelChars("a b"), false);
});

test("toLabel: 앞뒤 공백 제거, 공백 덩어리는 `_` 하나로", () => {
  assert.equal(toLabel("  cache   scan\tfix "), "cache_scan_fix");
});
