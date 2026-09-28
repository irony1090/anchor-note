import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByFile, groupByTag, highlightRanges, markerSpots, matches, parseQuery, plainText, snippet } from "../src/core/browse";
import type { BrowseNote } from "../src/core/browse";
import type { Anchor } from "../src/notes/frontmatter";

const note = (label: string, extra: Partial<BrowseNote> = {}): BrowseNote => ({ label, title: label, text: "", tags: [], anchors: [], ...extra });
const m = (path: string, id?: string): Anchor => (id === undefined ? { kind: "marker", path } : { kind: "marker", path, id });
const f = (path: string): Anchor => ({ kind: "file", path });

test("plainText: 줄 앞 기호·강조·링크를 빼고 한 줄로", () => {
  const body = "# 제목\n\n> 인용 **굵게** *기울임*\n- [ ] 할 일 [링크](http://x)\n1. `code` ![그림](a.png)\n\n---\n| a | b |\n|---|---|";
  assert.equal(plainText(body), "제목 인용 굵게 기울임 할 일 링크 code 그림 a b");
});

test("plainText: 펜스 줄은 빼고 코드 내용은 남긴다, 라벨의 _와 #태그는 그대로", () => {
  assert.equal(plainText("uart_err 처리 #esp32\n```c\nint x = 1;\n```\n끝"), "uart_err 처리 #esp32 int x = 1; 끝");
});

test("plainText: 빈 본문은 빈 글", () => {
  assert.equal(plainText("\n\n  \n"), "");
});

test("markerSpots: 여는 마커만, 줄·칸은 0부터, id 없으면 필드도 없다", () => {
  const spots = markerSpots(["x", "// @note:a#u1 @note:b", "// @note:/a#u1"], "@note:", "src/a.c");
  assert.deepEqual(spots, [
    { label: "a", id: "u1", path: "src/a.c", line: 1, character: 3 },
    { label: "b", path: "src/a.c", line: 1, character: 14 },
  ]);
});

test("parseQuery: 소문자, #는 태그, 빈 #는 무시", () => {
  assert.deepEqual(parseQuery("  UART  #ESP32 # baud "), { words: ["uart", "baud"], tags: ["esp32"] });
});

test("matches: 제목·라벨·본문·경로 부분 일치, 모든 말이 맞아야", () => {
  const n = note("uart_err", { title: "UART 에러", text: "프레이밍 에러는 재시도하지 않는다", anchors: [m("src/uart.c")] });
  assert.ok(matches(n, parseQuery("에러 uart.c")));
  assert.ok(matches(n, parseQuery("ERR")));
  assert.ok(!matches(n, parseQuery("에러 boot")));
  assert.ok(matches(n, parseQuery("")));
});

test("matches: 태그는 앞부분 일치 (계층 태그 포함)", () => {
  const n = note("a", { tags: ["esp32/uart"] });
  assert.ok(matches(n, parseQuery("#esp32")));
  assert.ok(matches(n, parseQuery("#ESP32/u")));
  assert.ok(!matches(n, parseQuery("#uart")));
});

test("snippet: 앞부분에서 맞으면 처음부터, 뒤에서 맞으면 그 단어 머리부터", () => {
  const text = `${"가".repeat(50)} 앞말 목표물 뒤말`;
  assert.equal(snippet("짧은 글", []), "짧은 글");
  assert.equal(snippet(text, ["가가"]), text);
  assert.equal(snippet(text, ["표물"]), "…목표물 뒤말");
  assert.equal(snippet(`${"가".repeat(60)}목표`, ["목표"]), `…${"가".repeat(10)}목표`);
  assert.equal(snippet("a".repeat(200), []), `${"a".repeat(160)}…`);
});

test("highlightRanges: 대소문자 무시, 겹치면 합친다", () => {
  assert.deepEqual(highlightRanges("UART uart", ["uar", "art"]), [
    [0, 4],
    [5, 9],
  ]);
  assert.deepEqual(highlightRanges("abc", []), []);
});

test("groupByFile: 경로순, 안은 제목순, 같은 파일 앵커는 한 항목에, 앵커 없는 메모는 따로", () => {
  const a = note("a", { title: "B 제목", anchors: [m("src/x.c", "1"), m("src/x.c", "2"), f("doc.png")] });
  const b = note("b", { title: "A 제목", anchors: [m("src/x.c")] });
  const c = note("c");
  const { groups, loose } = groupByFile([a, b, c]);
  assert.deepEqual(
    groups.map((g) => [g.path, g.items.map((i) => [i.note.label, i.anchors.length])]),
    [
      ["doc.png", [["a", 1]]],
      ["src/x.c", [["b", 1], ["a", 2]]],
    ],
  );
  assert.deepEqual(loose.map((n) => n.label), ["c"]);
});

test("groupByTag: 태그 이름순, 여러 태그면 여러 묶음에, 태그 없는 메모는 따로", () => {
  const { groups, loose } = groupByTag([note("a", { tags: ["z", "boot"] }), note("b", { tags: ["boot"] }), note("c")]);
  assert.deepEqual(
    groups.map((g) => [g.tag, g.notes.map((n) => n.label)]),
    [
      ["boot", ["a", "b"]],
      ["z", ["a"]],
    ],
  );
  assert.deepEqual(loose.map((n) => n.label), ["c"]);
});
