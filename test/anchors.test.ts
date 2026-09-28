import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dropAnchors,
  dropFileAnchor,
  fileAnchor,
  fileAnchorIndex,
  labelsInLines,
  markerAnchor,
  renameAnchors,
  rescanAnchors,
  sameAnchor,
  sameAnchors,
  syncFileAnchors,
} from "../src/core/anchors";
import type { Anchor } from "../src/notes/frontmatter";

const m = (path: string, id?: string): Anchor => markerAnchor(path, id);
const f = (path: string): Anchor => ({ kind: "file", path });
const ids = (...list: Array<string | undefined>) => new Set(list);

test("labelsInLines: 라벨 -> id들 (파일 순서, 중복은 하나, id 없음 = undefined)", () => {
  const found = labelsInLines(["// @note:a#x", "@note:b @note:a", "@note:a#x @note:a#y", "@note:c."], "@note:");
  assert.deepEqual([...found.keys()], ["a", "b"]);
  assert.deepEqual([...found.get("a")!], ["x", undefined, "y"]);
  assert.deepEqual([...found.get("b")!], [undefined]);
});

test("markerAnchor: id가 없으면 필드도 없다", () => {
  assert.deepEqual(markerAnchor("a.ts", undefined), { kind: "marker", path: "a.ts" });
  assert.deepEqual(markerAnchor("a.ts", "x"), { kind: "marker", path: "a.ts", id: "x" });
});

test("syncFileAnchors: id 없는 마커 — 생기면 추가, 없어지면 제거, 그대로면 null", () => {
  assert.deepEqual(syncFileAnchors([m("a.ts")], "b.ts", ids(undefined)), [m("a.ts"), m("b.ts")]);
  assert.deepEqual(syncFileAnchors([m("a.ts"), m("b.ts")], "b.ts", ids()), [m("a.ts")]);
  assert.equal(syncFileAnchors([m("a.ts")], "a.ts", ids(undefined)), null);
  assert.equal(syncFileAnchors([m("a.ts")], "b.ts", ids()), null);
});

test("syncFileAnchors: id별로 따로 — 같은 파일에 여러 앵커", () => {
  assert.deepEqual(syncFileAnchors([m("a.ts")], "a.ts", ids(undefined, "fix", "cause")), [m("a.ts"), m("a.ts", "fix"), m("a.ts", "cause")]);
  assert.deepEqual(syncFileAnchors([m("a.ts"), m("a.ts", "fix")], "a.ts", ids("fix")), [m("a.ts", "fix")]);
  // id를 바꾸면 옛 앵커가 빠지고 새 앵커가 뒤에 붙는다
  assert.deepEqual(syncFileAnchors([m("a.ts", "old"), m("b.ts")], "a.ts", ids("new")), [m("b.ts"), m("a.ts", "new")]);
  assert.equal(syncFileAnchors([m("a.ts", "x"), m("a.ts")], "a.ts", ids(undefined, "x")), null);
});

test("syncFileAnchors: 다른 파일의 같은 id는 별개 (id 유일 범위 = 파일 안)", () => {
  assert.deepEqual(syncFileAnchors([m("a.ts", "fix")], "b.ts", ids("fix")), [m("a.ts", "fix"), m("b.ts", "fix")]);
});

test("syncFileAnchors: file 앵커는 마커 스캔과 무관", () => {
  assert.equal(syncFileAnchors([f("a.md")], "a.md", ids()), null);
  assert.deepEqual(syncFileAnchors([f("a.md")], "a.md", ids(undefined)), [f("a.md"), m("a.md")]);
});

test("renameAnchors: 두 종류 모두 옮기고, (종류, 경로, id)가 겹치면 합친다", () => {
  assert.deepEqual(renameAnchors([m("src/a.ts", "x"), f("src/b.md"), m("srcx/c.ts")], "src", "lib"), [
    m("lib/a.ts", "x"),
    f("lib/b.md"),
    m("srcx/c.ts"),
  ]);
  assert.deepEqual(renameAnchors([m("a.ts"), m("b.ts")], "a.ts", "b.ts"), [m("b.ts")]);
  assert.deepEqual(renameAnchors([m("a.ts", "x"), m("b.ts")], "a.ts", "b.ts"), [m("b.ts", "x"), m("b.ts")]);
  assert.deepEqual(renameAnchors([m("a.ts"), f("b.ts")], "a.ts", "b.ts"), [m("b.ts"), f("b.ts")]);
  assert.equal(renameAnchors([m("a.ts")], "b.ts", "c.ts"), null);
});

test("dropAnchors: 두 종류·모든 id", () => {
  assert.deepEqual(dropAnchors([m("src/a.ts"), m("src/a.ts", "x"), f("src/b.md"), m("x.ts")], "src"), [m("x.ts")]);
  assert.equal(dropAnchors([m("a.ts")], "b.ts"), null);
});

test("rescanAnchors: (경로, id)로 맞추고 file 앵커는 남긴다. 새 앵커는 경로순, 같은 경로는 파일 순서", () => {
  const found = new Map([
    ["z.ts", ids(undefined)],
    ["b.ts", ids("keep", "new")],
    ["c.ts", ids("q", undefined)],
  ]);
  assert.deepEqual(rescanAnchors([m("b.ts", "keep"), f("r.md"), m("b.ts"), m("gone.ts")], found), [
    m("b.ts", "keep"),
    f("r.md"),
    m("b.ts", "new"),
    m("c.ts", "q"),
    m("c.ts"),
    m("z.ts"),
  ]);
});

test("sameAnchor·sameAnchors: 종류·경로·id 비교", () => {
  assert.equal(sameAnchor(m("a.ts", "x"), m("a.ts", "x")), true);
  assert.equal(sameAnchor(m("a.ts", "x"), m("a.ts")), false);
  assert.equal(sameAnchor(m("a.ts"), f("a.ts")), false);
  assert.equal(sameAnchors([m("a.ts")], [m("a.ts")]), true);
  assert.equal(sameAnchors([m("a.ts"), m("a.ts", "x")], [m("a.ts", "x"), m("a.ts")]), false);
  assert.equal(sameAnchors([m("a.ts")], []), false);
});

test("fileAnchorIndex: file 앵커만, 경로별 라벨순, 한 메모의 같은 경로는 하나", () => {
  const index = fileAnchorIndex([
    { label: "b", anchors: [{ kind: "file", path: "data.json" }, { kind: "marker", path: "src/a.ts" }] },
    { label: "a", anchors: [{ kind: "file", path: "data.json" }, { kind: "file", path: "logo.png" }, { kind: "file", path: "logo.png" }] },
    { label: "c", anchors: [{ kind: "marker", path: "data.json" }] },
  ]);
  assert.deepEqual([...index], [
    ["data.json", ["a", "b"]],
    ["logo.png", ["a"]],
  ]);
});

test("dropFileAnchor: 그 경로의 file 앵커만 빼고, 없으면 null", () => {
  const anchors: Anchor[] = [{ kind: "marker", path: "a.json" }, { kind: "file", path: "a.json" }, { kind: "file", path: "b.png" }];
  assert.deepEqual(dropFileAnchor(anchors, "a.json"), [{ kind: "marker", path: "a.json" }, { kind: "file", path: "b.png" }]);
  assert.equal(dropFileAnchor(anchors, "c.txt"), null);
  assert.deepEqual(fileAnchor("x.csv"), { kind: "file", path: "x.csv" });
});
