// 둘러보기 웹뷰 (R9 둘러보기 페이지 — C 사이드바 웹뷰). 검색·묶음은 입력마다 호스트 왕복 없이 여기서 다시 그린다

import { groupByFile, groupByTag, highlightRanges, isEmptyQuery, matches, parseQuery, snippet } from "../src/core/browse";
import type { BrowseNote, MarkerSpot, Query } from "../src/core/browse";
import type { BrowseToHost, HostToBrowse } from "../src/browse/protocol";
import type { Anchor } from "../src/notes/frontmatter";

interface VsCodeApi {
  postMessage(message: BrowseToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type Mode = "file" | "tag";

// 뷰를 숨겼다 다시 열어도 남는 것 (웹뷰 state)
interface ViewState {
  mode: Mode;
  query: string;
  closed: string[];
}

const api = acquireVsCodeApi();
const saved = (api.getState() ?? {}) as Partial<ViewState>;
const search = byId<HTMLInputElement>("search");
const modesEl = byId<HTMLDivElement>("modes");
const list = byId<HTMLDivElement>("list");

let mode: Mode = saved.mode === "tag" ? "tag" : "file";
// 접은 묶음 키. 검색 중에는 무시하고 전부 편다
const closed = new Set(saved.closed ?? []);
let notes: BrowseNote[] | null = null;
let orphans: MarkerSpot[] | null = null;
let active: string | null = null;

search.value = saved.query ?? "";

search.addEventListener("input", () => {
  save();
  render();
});
search.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && search.value !== "") {
    search.value = "";
    save();
    render();
  }
});
modesEl.addEventListener("click", (event) => {
  const picked = (event.target as Element).closest<HTMLButtonElement>("button")?.dataset.mode;
  if (picked === "file" || picked === "tag") {
    mode = picked;
    save();
    render();
  }
});

window.addEventListener("message", (event: MessageEvent<HostToBrowse>) => {
  const message = event.data;
  switch (message.type) {
    case "notes":
      notes = message.notes;
      break;
    case "orphans":
      orphans = message.spots === null ? null : [...message.spots].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
      break;
    case "active":
      active = message.label;
      break;
    default: {
      const unhandled: never = message;
      console.error("[anchor-notes] unhandled host message", unhandled);
    }
  }
  render();
});

render();
api.postMessage({ type: "ready" });

function save(): void {
  const state: ViewState = { mode, query: search.value, closed: [...closed] };
  api.setState(state);
}

function render(): void {
  for (const b of modesEl.querySelectorAll<HTMLButtonElement>("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  }
  if (notes === null) {
    list.replaceChildren();
    return;
  }
  const query = parseQuery(search.value);
  const shown = notes.filter((note) => matches(note, query));
  const parts: HTMLElement[] = [];

  if (mode === "file") {
    const { groups, loose } = groupByFile(shown);
    for (const group of groups) {
      parts.push(section(`file:${group.path}`, [pathButton(group.path)], group.items.length, query, group.items.map(({ note, anchors }) => item(note, query, anchors))));
    }
    if (loose.length > 0) {
      parts.push(section("file:", [el("span", "grp-name dim", "앵커 없는 메모")], loose.length, query, loose.map((note) => item(note, query))));
    }
  } else {
    const { groups, loose } = groupByTag(shown);
    for (const group of groups) {
      parts.push(section(`tag:${group.tag}`, [el("span", "tag", `#${group.tag}`)], group.notes.length, query, group.notes.map((note) => item(note, query))));
    }
    if (loose.length > 0) {
      parts.push(section("tag:", [el("span", "grp-name dim", "태그 없는 메모")], loose.length, query, loose.map((note) => item(note, query))));
    }
  }

  if (shown.length === 0) {
    parts.unshift(el("p", "empty", notes.length === 0 ? "메모가 없습니다. 코드에서 Ctrl+Alt+M으로 만듭니다." : "맞는 메모가 없습니다."));
  }
  const spots = orphanRows(query);
  if (spots.length > 0) {
    parts.push(section("orphans", [el("span", "grp-name warn", "노트 없는 마커")], spots.length, query, spots.map(orphanRow)));
  }
  list.replaceChildren(...parts);
}

// 묶음: 머리(접기 + 이름 + 개수) + 항목들
function section(key: string, head: HTMLElement[], count: number, query: Query, rows: HTMLElement[]): HTMLElement {
  const box = el("section", "grp");
  const open = !isEmptyQuery(query) || !closed.has(key);
  const header = el("div", "grp-head");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "grp-toggle";
  toggle.textContent = open ? "▾" : "▸";
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "묶음 접기" : "묶음 펼치기");
  toggle.addEventListener("click", () => {
    if (closed.has(key)) {
      closed.delete(key);
    } else {
      closed.add(key);
    }
    save();
    render();
  });
  header.append(toggle, ...head, el("span", "grp-count", String(count)));
  box.append(header);
  if (open) {
    box.append(...rows);
  }
  return box;
}

// 파일 묶음 머리의 경로. 누르면 그 파일을 연다
function pathButton(path: string): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "grp-path";
  b.title = `${path} 열기`;
  const cut = path.lastIndexOf("/") + 1;
  b.append(el("span", "path-dir", path.slice(0, cut)), el("span", "path-base", path.slice(cut)));
  b.addEventListener("click", () => api.postMessage({ type: "openFile", path }));
  return b;
}

// 메모 한 줄: 제목·라벨·(파일별이면) 이 파일 앵커 칩 / 본문 두 줄. 누르면 메모 에디터
function item(note: BrowseNote, query: Query, anchors?: Anchor[]): HTMLElement {
  const row = el("div", note.label === active ? "item active" : "item");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.title = "메모 열기";
  const line = el("div", "item-line");
  line.append(highlighted("span", "item-title", note.title, query.words));
  if (note.title !== note.label) {
    line.append(highlighted("span", "item-label", note.label, query.words));
  }
  if (anchors !== undefined) {
    const chips = el("span", "item-anchors");
    chips.append(...anchors.map((anchor) => anchorChip(note.label, anchor)));
    line.append(chips);
  }
  const text = snippet(note.text, query.words);
  row.append(line, text === "" ? el("div", "item-snip dim", "(빈 메모)") : highlighted("div", "item-snip", text, query.words));

  const open = () => api.postMessage({ type: "openNote", label: note.label });
  row.addEventListener("click", open);
  row.addEventListener("keydown", (event) => {
    if (event.target === row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      open();
    }
  });
  return row;
}

// 앵커 칩: `#id` / 마커(id 없음) / 파일. 누르면 그 자리로
function anchorChip(label: string, anchor: Anchor): HTMLElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `chip ${anchor.kind}`;
  if (anchor.kind === "file") {
    chip.textContent = "파일";
    chip.title = "파일 앵커 — 파일 열기";
  } else {
    chip.textContent = anchor.id === undefined ? "마커" : `#${anchor.id}`;
    chip.title = "마커로 이동";
  }
  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    api.postMessage({ type: "openAnchor", label, anchor });
  });
  return chip;
}

// 태그 검색 중에는 숨긴다 (마커에는 태그가 없다). 말은 라벨·경로에 부분 일치
function orphanRows(query: Query): MarkerSpot[] {
  if (orphans === null || query.tags.length > 0) {
    return [];
  }
  return orphans.filter((spot) => {
    const haystack = `${markerName(spot)} ${spot.path}`.toLowerCase();
    return query.words.every((word) => haystack.includes(word));
  });
}

function orphanRow(spot: MarkerSpot): HTMLElement {
  const row = el("div", "orphan");
  const where = document.createElement("button");
  where.type = "button";
  where.className = "orphan-where";
  where.title = "마커로 이동";
  where.append(el("span", "orphan-name", markerName(spot)), el("span", "orphan-path", `${spot.path}:${spot.line + 1}`));
  where.addEventListener("click", () => api.postMessage({ type: "openSpot", spot }));
  const create = document.createElement("button");
  create.type = "button";
  create.className = "orphan-create";
  create.textContent = "메모 만들기";
  create.addEventListener("click", () => api.postMessage({ type: "createNote", spot }));
  row.append(where, create);
  return row;
}

function markerName(spot: MarkerSpot): string {
  return spot.id === undefined ? spot.label : `${spot.label}#${spot.id}`;
}

// 검색어와 맞은 글자를 <mark>로
function highlighted(tag: string, className: string, text: string, words: readonly string[]): HTMLElement {
  const node = el(tag, className);
  let at = 0;
  for (const [start, end] of highlightRanges(text, words)) {
    node.append(text.slice(at, start), el("mark", "", text.slice(start, end)));
    at = end;
  }
  node.append(text.slice(at));
  return node;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className !== "") {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`#${id} 없음`);
  }
  return node as T;
}
