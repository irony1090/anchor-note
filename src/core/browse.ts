// 둘러보기 목록 계산 (R9 둘러보기 페이지). 호스트가 미리보기 글·마커 위치에, 웹뷰가 검색·묶음에 쓴다 — vscode 없음
import type { Anchor } from "../notes/frontmatter";
import { markdownLines } from "./fence";
import { markersIn } from "./marker";

// 웹뷰로 보내는 메모 하나. text = 마크다운 기호를 뺀 본문 전체 (미리보기·검색)
export interface BrowseNote {
  label: string;
  title: string;
  text: string;
  tags: string[];
  anchors: Anchor[];
}

// 여는 마커 한 곳 (V5 노트 없는 마커). line·character는 0부터
export interface MarkerSpot {
  label: string;
  id?: string;
  path: string;
  line: number;
  character: number;
}

// 본문 -> 한 줄 글. 펜스 줄은 빼고 코드 내용은 남긴다 (코드가 메모를 구분하는 단서일 때가 많다). 첫 줄이 제목과 같은 머리글이면 뺀다 — 목록에 제목이 이미 있다
export function plainText(body: string, title?: string): string {
  const parts: string[] = [];
  let first = true;
  for (const { text, kind } of markdownLines(body)) {
    if (kind === "open" || kind === "close") {
      continue;
    }
    if (first && text.trim() !== "") {
      first = false;
      if (kind === "text" && title !== undefined && headingText(text) === title.trim()) {
        continue;
      }
    }
    const line = kind === "code" ? text : stripInline(stripBlock(text));
    if (line.trim() !== "") {
      parts.push(line.trim());
    }
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

// ATX 머리글(`# 제목 #`)의 글자. 머리글이 아니면 null
function headingText(line: string): string | null {
  const match = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
  return match === null ? null : match[1];
}

// 줄 앞 기호: 제목·인용·목록·할 일. 가로줄·표 구분 줄·setext 밑줄은 통째로 뺀다
function stripBlock(line: string): string {
  if (/^\s{0,3}([-*_=])(\s*\1){2,}\s*$/.test(line) || (/^[\s|:-]+$/.test(line) && line.includes("---"))) {
    return "";
  }
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^(\s*>\s?)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
}

// 줄 안 기호: 이미지·링크는 글자만, 강조·백틱·HTML·표 칸 구분 제거. 라벨의 `_`는 건드리지 않는다
function stripInline(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*/g, "$1$2")
    .replace(/`+/g, "")
    .replace(/\|/g, " ");
}

// 한 파일의 여는 마커 위치. 닫는 마커(D26)는 뺀다
export function markerSpots(lines: readonly string[], prefix: string, path: string): MarkerSpot[] {
  const spots: MarkerSpot[] = [];
  lines.forEach((text, line) => {
    for (const hit of markersIn(text, prefix)) {
      if (hit.close !== true) {
        spots.push(hit.id === undefined ? { label: hit.label, path, line, character: hit.start } : { label: hit.label, id: hit.id, path, line, character: hit.start });
      }
    }
  });
  return spots;
}

// --- 검색 (V3) ---

// 소문자. words = 제목·라벨·본문·경로 부분 일치, tags = `#`로 시작한 말 — 태그 앞부분 일치(`#a`가 `a/b`에 맞음). 전부 AND
export interface Query {
  words: string[];
  tags: string[];
}

export function parseQuery(input: string): Query {
  const query: Query = { words: [], tags: [] };
  for (const part of input.toLowerCase().split(/\s+/)) {
    if (part.startsWith("#")) {
      if (part.length > 1) {
        query.tags.push(part.slice(1));
      }
    } else if (part !== "") {
      query.words.push(part);
    }
  }
  return query;
}

export function isEmptyQuery(query: Query): boolean {
  return query.words.length === 0 && query.tags.length === 0;
}

export function matches(note: BrowseNote, query: Query): boolean {
  if (!query.tags.every((tag) => note.tags.some((own) => own.toLowerCase().startsWith(tag)))) {
    return false;
  }
  const haystack = [note.title, note.label, note.text, ...note.anchors.map((anchor) => anchor.path)].join("\n").toLowerCase();
  return query.words.every((word) => haystack.includes(word));
}

// 미리보기 글. 검색어가 첫 lead자 밖에서 처음 맞으면 그 조금 앞(단어 경계)부터 자른다. 사이드바 두 줄에 한글 40자 남짓이 보인다
export function snippet(text: string, words: readonly string[], max = 160, lead = 40): string {
  const lower = text.toLowerCase();
  const first = Math.min(...words.map((word) => lower.indexOf(word)).filter((at) => at >= 0));
  if (!Number.isFinite(first) || first < lead) {
    return cut(text, 0, max);
  }
  const space = text.lastIndexOf(" ", first - 1);
  const start = space >= first - 15 ? space + 1 : first - 10;
  return `…${cut(text, start, max)}`;
}

function cut(text: string, start: number, max: number): string {
  return start + max < text.length ? `${text.slice(start, start + max)}…` : text.slice(start);
}

// 강조할 글자 범위 [시작, 끝) — 겹치면 합친다. 소문자로 바꿔 길이가 달라지는 글자가 있으면 강조를 포기한다
export function highlightRanges(text: string, words: readonly string[]): Array<[number, number]> {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) {
    return [];
  }
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) {
      ranges.push([at, at + word.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  return merged;
}

// --- 묶음 (V2) — 묶음은 이름순, 묶음 안은 제목순 ---

export interface FileGroup {
  path: string;
  // anchors = 이 메모의 앵커 중 이 경로의 것 (파일 앵커·마커 앵커)
  items: Array<{ note: BrowseNote; anchors: Anchor[] }>;
}

export interface TagGroup {
  tag: string;
  notes: BrowseNote[];
}

// 앵커 경로마다 한 묶음. 앵커가 여러 파일이면 여러 묶음에 나온다. loose = 앵커 없는 메모
export function groupByFile(notes: readonly BrowseNote[]): { groups: FileGroup[]; loose: BrowseNote[] } {
  const byPath = new Map<string, FileGroup>();
  const loose: BrowseNote[] = [];
  for (const note of notes) {
    if (note.anchors.length === 0) {
      loose.push(note);
    }
    for (const anchor of note.anchors) {
      const group = byPath.get(anchor.path) ?? { path: anchor.path, items: [] };
      const item = group.items.find((known) => known.note === note);
      if (item === undefined) {
        group.items.push({ note, anchors: [anchor] });
      } else {
        item.anchors.push(anchor);
      }
      byPath.set(anchor.path, group);
    }
  }
  const groups = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  groups.forEach((group) => group.items.sort((a, b) => byTitle(a.note, b.note)));
  return { groups, loose: loose.sort(byTitle) };
}

// 태그마다 한 묶음. loose = 태그 없는 메모
export function groupByTag(notes: readonly BrowseNote[]): { groups: TagGroup[]; loose: BrowseNote[] } {
  const byTag = new Map<string, BrowseNote[]>();
  const loose: BrowseNote[] = [];
  for (const note of notes) {
    if (note.tags.length === 0) {
      loose.push(note);
    }
    for (const tag of note.tags) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), note]);
    }
  }
  const groups = [...byTag].map(([tag, list]) => ({ tag, notes: list.sort(byTitle) })).sort((a, b) => a.tag.localeCompare(b.tag));
  return { groups, loose: loose.sort(byTitle) };
}

function byTitle(a: BrowseNote, b: BrowseNote): number {
  return a.title.localeCompare(b.title) || a.label.localeCompare(b.label);
}
