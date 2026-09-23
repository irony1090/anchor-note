import { test } from "node:test";
import assert from "node:assert/strict";
import { dropAnchors, labelsInLines, renameAnchors, rescanAnchors, sameAnchors, syncFileAnchors } from "../src/core/anchors";
import type { Anchor } from "../src/notes/frontmatter";

const m = (path: string): Anchor => ({ kind: "marker", path });
const f = (path: string): Anchor => ({ kind: "file", path });

test("labelsInLines: 파일 안 마커의 라벨들", () => {
  assert.deepEqual([...labelsInLines(["// @note:a", "x @note:b#fix @note:a", "@note:c."], "@note:")], ["a", "b"]);
});

test("syncFileAnchors: 마커가 생기면 marker 앵커 추가, 없어지면 제거, 그대로면 null", () => {
  assert.deepEqual(syncFileAnchors([m("a.ts")], "b.ts", true), [m("a.ts"), m("b.ts")]);
  assert.deepEqual(syncFileAnchors([m("a.ts"), m("b.ts")], "b.ts", false), [m("a.ts")]);
  assert.equal(syncFileAnchors([m("a.ts")], "a.ts", true), null);
  assert.equal(syncFileAnchors([m("a.ts")], "b.ts", false), null);
});

test("syncFileAnchors: file 앵커는 마커 스캔과 무관", () => {
  assert.equal(syncFileAnchors([f("a.md")], "a.md", false), null);
  assert.deepEqual(syncFileAnchors([f("a.md")], "a.md", true), [f("a.md"), m("a.md")]);
});

test("renameAnchors: 파일·폴더 이름 변경은 두 종류 모두, 겹치면 합친다", () => {
  assert.deepEqual(renameAnchors([m("src/a.ts"), f("src/b.md"), m("srcx/c.ts")], "src", "lib"), [
    m("lib/a.ts"),
    f("lib/b.md"),
    m("srcx/c.ts"),
  ]);
  assert.deepEqual(renameAnchors([m("a.ts"), m("b.ts")], "a.ts", "b.ts"), [m("b.ts")]);
  assert.deepEqual(renameAnchors([m("a.ts"), f("b.ts")], "a.ts", "b.ts"), [m("b.ts"), f("b.ts")]);
  assert.equal(renameAnchors([m("a.ts")], "b.ts", "c.ts"), null);
});

test("dropAnchors: 파일·폴더 삭제는 두 종류 모두", () => {
  assert.deepEqual(dropAnchors([m("src/a.ts"), f("src/b.md"), m("x.ts")], "src"), [m("x.ts")]);
  assert.equal(dropAnchors([m("a.ts")], "b.ts"), null);
});

test("rescanAnchors: marker 앵커만 맞추고 file 앵커는 남긴다. 새 앵커는 경로순으로 뒤에", () => {
  assert.deepEqual(rescanAnchors([m("b.ts"), f("r.md"), m("gone.ts")], new Set(["z.ts", "b.ts", "c.ts"])), [
    m("b.ts"),
    f("r.md"),
    m("c.ts"),
    m("z.ts"),
  ]);
});

test("sameAnchors: 종류까지 비교", () => {
  assert.equal(sameAnchors([m("a.ts")], [m("a.ts")]), true);
  assert.equal(sameAnchors([m("a.ts")], [f("a.ts")]), false);
  assert.equal(sameAnchors([m("a.ts")], []), false);
});
