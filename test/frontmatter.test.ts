import { test } from "node:test";
import assert from "node:assert/strict";
import { BrokenNoteError, bodyOffset, parseNote, serializeMeta, serializeNote, updatedEdit } from "../src/notes/frontmatter";
import type { NoteMeta } from "../src/notes/frontmatter";

const note = (...head: string[]) => ["---", ...head, "---", "body"].join("\n");

test("parseNote: 새 형식 — marker(+id)·file 섞기", () => {
  const { meta, body } = parseNote(
    note(
      "label: cache-scan",
      "title: 스캔 캐시",
      "anchors:",
      "  - marker: src/scan.ts",
      "  - marker: src/scan.ts",
      "    id: fix",
      "  - file: README.md",
      "created: 2026-09-18T10:00:00Z",
      "updated: 2026-09-18T11:00:00Z",
    ),
    "cache-scan",
  );
  assert.deepEqual(meta, {
    title: "스캔 캐시",
    anchors: [
      { kind: "marker", path: "src/scan.ts" },
      { kind: "marker", path: "src/scan.ts", id: "fix" },
      { kind: "file", path: "README.md" },
    ],
    created: "2026-09-18T10:00:00Z",
    updated: "2026-09-18T11:00:00Z",
    extra: [],
  });
  assert.equal(body, "body");
});

test("parseNote: 옛 형식 kind=marker — path는 marker, lineText·kind는 버린다", () => {
  const { meta } = parseNote(
    note("label: a", "kind: marker", "title: a", "anchors:", "  - path: src/a.ts", '    lineText: "x // @note:a"'),
    "a",
  );
  assert.deepEqual(meta.anchors, [{ kind: "marker", path: "src/a.ts" }]);
  assert.deepEqual(meta.extra, []);
});

test("parseNote: 옛 형식 kind=file — kind 줄이 anchors 뒤에 있어도", () => {
  const { meta } = parseNote(note("anchors:", "  - path: README.md", "kind: file"), "a");
  assert.deepEqual(meta.anchors, [{ kind: "file", path: "README.md" }]);
});

test("parseNote: kind가 없는 옛 노트는 marker", () => {
  const { meta } = parseNote(note("anchors:", "  - path: src/a.ts"), "a");
  assert.deepEqual(meta.anchors, [{ kind: "marker", path: "src/a.ts" }]);
});

test("parseNote: 빈 anchors·따옴표 값", () => {
  const { meta } = parseNote(note("anchors: []", 'title: "a: b"'), "a");
  assert.deepEqual(meta.anchors, []);
  assert.equal(meta.title, "a: b");
});

test("parseNote: 숫자 id는 따옴표로 읽힌다", () => {
  const { meta } = parseNote(note("anchors:", "  - marker: src/a.ts", '    id: "2"'), "a");
  assert.deepEqual(meta.anchors, [{ kind: "marker", path: "src/a.ts", id: "2" }]);
});

test("parseNote: 모르는 키는 딸린 줄까지 원문 보존 (D20 서브셋 frontmatter 파서)", () => {
  const { meta } = parseNote(note("title: a", "tags:", "  - x", "  - y", "# comment", "parent: b"), "a");
  assert.deepEqual(meta.extra, ["tags:", "  - x", "  - y", "# comment", "parent: b"]);
});

test("parseNote: title이 없으면 라벨", () => {
  assert.equal(parseNote(note("anchors: []"), "lbl").meta.title, "lbl");
});

test("parseNote: 깨진 파일은 BrokenNoteError", () => {
  const cases = [
    "no frontmatter",
    "---\ntitle: a\n",
    note("anchors: [a]"),
    note("anchors: x"),
    note("anchors:", "  - id: x"),
    note("anchors:", "  - marker: a", "    file: b"),
    note("이상한 줄"),
    note('title: "a\\"'), // 따옴표로 끝나지만 이스케이프된 따옴표라 안 닫힘
  ];
  for (const text of cases) {
    assert.throws(() => parseNote(text, "a"), BrokenNoteError, JSON.stringify(text));
  }
});

const meta = (anchors: NoteMeta["anchors"], extra: string[] = []): NoteMeta => ({
  title: "스캔 캐시",
  anchors,
  created: "2026-09-18T10:00:00Z",
  updated: "2026-09-18T11:00:00Z",
  extra,
});

test("serializeMeta: 안 C(키 이름이 종류) — kind 줄·lineText 없음", () => {
  const text = serializeMeta(
    "cache-scan",
    meta([
      { kind: "marker", path: "src/scan.ts" },
      { kind: "marker", path: "src/scan.ts", id: "fix" },
      { kind: "marker", path: "src/a.ts", id: "2" },
      { kind: "file", path: "README.md" },
    ]),
  );
  assert.equal(
    text,
    [
      "---",
      "label: cache-scan",
      "title: 스캔 캐시",
      "anchors:",
      "  - marker: src/scan.ts",
      "  - marker: src/scan.ts",
      "    id: fix",
      "  - marker: src/a.ts",
      '    id: "2"',
      "  - file: README.md",
      "created: 2026-09-18T10:00:00Z",
      "updated: 2026-09-18T11:00:00Z",
      "---",
      "",
    ].join("\n"),
  );
});

test("serializeMeta: 빈 anchors·extra·CRLF", () => {
  assert.equal(
    serializeMeta("a", meta([], ["parent: b"]), "\r\n"),
    "---\r\nlabel: a\r\ntitle: 스캔 캐시\r\nanchors: []\r\ncreated: 2026-09-18T10:00:00Z\r\nupdated: 2026-09-18T11:00:00Z\r\nparent: b\r\n---\r\n",
  );
});

test("옛 형식 -> 읽기 -> 쓰기 = 새 형식 (마이그레이션)", () => {
  const old = note(
    "label: a",
    "kind: file",
    "title: a",
    "anchors:",
    "  - path: README.md",
    '    lineText: "# Title"',
    "created: 2026-09-18T10:00:00Z",
    "updated: 2026-09-18T10:00:00Z",
    "custom: keep",
  );
  const text = serializeNote("a", parseNote(old, "a"));
  assert.equal(
    text,
    note(
      "label: a",
      "title: a",
      "anchors:",
      "  - file: README.md",
      "created: 2026-09-18T10:00:00Z",
      "updated: 2026-09-18T10:00:00Z",
      "custom: keep",
    ),
  );
});

test("새 형식은 읽고 쓰면 그대로", () => {
  const text = serializeMeta("a", meta([{ kind: "marker", path: "a b/c:d.ts", id: "x.y" }, { kind: "file", path: "-dash" }]));
  assert.equal(serializeMeta("a", parseNote(`${text}body`, "a").meta), text);
});

test("bodyOffset: 닫는 --- 줄바꿈 뒤", () => {
  assert.equal(bodyOffset("---\na: 1\n---\nbody"), 13);
  assert.equal(bodyOffset("---\r\na: 1\r\n---\r\nbody"), 16);
  assert.equal(bodyOffset("no"), null);
});

test("updatedEdit: 있으면 교체, 없으면 닫는 --- 앞에 삽입", () => {
  const text = "---\nupdated: old\n---\n";
  assert.deepEqual(updatedEdit(text, "NOW"), { start: 4, end: 16, text: "updated: NOW" });
  assert.deepEqual(updatedEdit("---\na: 1\n---\n", "NOW"), { start: 9, end: 9, text: "updated: NOW\n" });
  assert.equal(updatedEdit("body", "NOW"), null);
});

test("parseNote: 동기화 정보 link (D27) — 줄 단위·열 단위", () => {
  const { meta } = parseNote(
    note(
      "anchors:",
      "  - marker: src/main.c",
      "    block: init",
      "    hash: 0be4c8d9",
      "  - marker: src/uart.c",
      "    id: u1",
      "    block: baud",
      '    prefix: ".baud_rate = "',
      '    suffix: ","',
      "    hash: 7c2e91a0",
      "  - marker: src/plain.c",
    ),
    "uart",
  );
  assert.deepEqual(meta.anchors, [
    { kind: "marker", path: "src/main.c", link: { block: "init", hash: "0be4c8d9" } },
    { kind: "marker", path: "src/uart.c", id: "u1", link: { block: "baud", prefix: ".baud_rate = ", suffix: ",", hash: "7c2e91a0" } },
    { kind: "marker", path: "src/plain.c" },
  ]);
});

test("parseNote: hash 없는 link는 hash \"\" · 빈 prefix는 \"있음\"", () => {
  const { meta } = parseNote(note("anchors:", "  - marker: a.c", '    prefix: ""', '    suffix: ";"'), "a");
  assert.deepEqual(meta.anchors, [{ kind: "marker", path: "a.c", link: { prefix: "", suffix: ";", hash: "" } }]);
});

test("serializeMeta: link는 block·prefix·suffix·hash 순, 코드 조각은 겹따옴표로 왕복", () => {
  const tricky = ['a: b # c "q" \\ x', "  lead", "tail  ", "", "line1\nline2", "- dash", "{x}", "'s'"];
  for (const prefix of tricky) {
    const meta: NoteMeta = {
      title: "t",
      anchors: [{ kind: "marker", path: "src/a.c", id: "u1", link: { block: "baud", prefix, suffix: ");", hash: "abc12345" } }],
      created: "",
      updated: "",
      extra: [],
    };
    const text = `${serializeMeta("a", meta)}body`;
    assert.deepEqual(parseNote(text, "a").meta.anchors, meta.anchors, JSON.stringify(prefix));
  }
  const head = serializeMeta("a", {
    title: "a",
    anchors: [{ kind: "marker", path: "x.c", link: { block: "b", prefix: "p(", suffix: ")", hash: "h" } }],
    created: "",
    updated: "",
    extra: [],
  });
  assert.equal(head, ["---", "label: a", "title: a", "anchors:", "  - marker: x.c", "    block: b", "    prefix: p(", "    suffix: )", "    hash: h", "---", ""].join("\n"));
});

test("serializeMeta: file 앵커에는 link를 쓰지 않는다", () => {
  const head = serializeMeta("a", { title: "a", anchors: [{ kind: "file", path: "x.json" }], created: "", updated: "", extra: [] });
  assert.ok(!head.includes("hash"));
});
