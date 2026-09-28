// 메모 에디터 웹뷰 (R4 메모 에디터) — 위 미리보기, 아래 입력. 미리보기는 입력마다 호스트 왕복 없이 다시 그린다

import { marked } from "marked";
import { codeBlocks } from "../src/core/codeblock";
import { isValidLabel } from "../src/core/label";
import { tagSpans, tagsIn } from "../src/core/tag";
import type { BlockLinks, BlockProblem, EditorToHost, HostToEditor, LinkRow, LinkState } from "../src/editor/protocol";
import type { Anchor } from "../src/notes/frontmatter";
import { Splitters } from "./splitters";
import { TagComplete } from "./tag-complete";

interface VsCodeApi {
  postMessage(message: EditorToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// 태그 자리를 표시 문자로 감싼 뒤 marked에 넘긴다. 태그 판정을 tagSpans 하나에 맡기려는 것 (저장소 태그 목록과 어긋나지 않게)
const TAG_OPEN = "\uE000";
const TAG_CLOSE = "\uE001";

// 코드 연결 상태 (R11 C8). 호스트가 linkStatus로 보낸다. 미리보기를 그릴 때마다 연결된 블록에 머리 줄을 붙인다
let links: { blocks: BlockLinks[]; problems: BlockProblem[] } = { blocks: [], problems: [] };
let linkOpen: Record<string, boolean> = {};
// 이번에 그리는 본문의 펜스 블록 수. 이름 없는 연결은 블록이 하나뿐일 때만 그 블록을 가리킨다 (key "")
let fenceCount = 0;

// 생 HTML은 버린다. 연결된 펜스 블록은 자리표만 두고 머리 줄은 decorateLinks가 DOM으로 붙인다
marked.use({
  gfm: true,
  renderer: {
    html: () => "",
    code: ({ text, lang, codeBlockStyle }) => {
      if (codeBlockStyle === "indented") {
        return false;
      }
      const [first = "", second] = (lang ?? "").split(/\s+/);
      const key = second !== undefined && isValidLabel(second) ? second : fenceCount === 1 ? "" : undefined;
      if (key === undefined || !links.blocks.some((block) => block.key === key)) {
        return false;
      }
      const cls = first === "" ? "" : ` class="language-${escapeHtml(first)}"`;
      return `<div class="code-link" data-key="${escapeHtml(key)}"><pre><code${cls}>${escapeHtml(text)}\n</code></pre></div>`;
    },
  },
  extensions: [
    {
      name: "tag",
      level: "inline",
      start: (src: string) => {
        const at = src.indexOf(TAG_OPEN);
        return at === -1 ? undefined : at;
      },
      tokenizer: (src: string) => {
        const match = new RegExp(`^${TAG_OPEN}([^${TAG_CLOSE}]*)${TAG_CLOSE}`).exec(src);
        return match === null ? undefined : { type: "tag", raw: match[0], tag: match[1] };
      },
      renderer: (token) => {
        const tag = escapeHtml(String(token.tag));
        return `<span class="tag" data-tag="${tag}" title="태그로 메모 찾기">#${tag}</span>`;
      },
    },
  ],
});

const api = acquireVsCodeApi();
const titleEl = byId<HTMLSpanElement>("title");
const labelEl = byId<HTMLSpanElement>("label");
const anchorsEl = byId<HTMLElement>("anchors");
const previewEl = byId<HTMLElement>("preview");
const errorEl = byId<HTMLParagraphElement>("error");
const input = byId<HTMLTextAreaElement>("input");
const deleteButton = byId<HTMLButtonElement>("delete");
const renameButton = byId<HTMLButtonElement>("rename");
const titleInput = byId<HTMLInputElement>("title-input");
const tagsEl = byId<HTMLDivElement>("tags");
const tagComplete = new TagComplete(input, byId<HTMLUListElement>("tag-popup"));
const splitters = new Splitters({ anchors: anchorsEl, preview: previewEl, input }, (layout) =>
  api.postMessage({ type: "layout", layout }),
);

// 앵커 칩 줄 끝의 [다시 찾기]. 밖에서 새로 생긴 마커는 칩이 없어 이 버튼으로 맞춘다 (REF-browse 2절).
// 누르면 끄고 "rescanned"에서 다시 켠다. 바뀐 앵커는 doc 메시지로 따로 와 칩을 다시 그린다
const rescanButton = document.createElement("button");
rescanButton.type = "button";
rescanButton.id = "rescan";
rescanButton.textContent = "다시 찾기";
rescanButton.title = "워크스페이스에서 마커를 다시 찾아 앵커를 맞춥니다 (git pull 등 VSCode 밖 변경 반영)";
rescanButton.addEventListener("click", () => {
  rescanButton.disabled = true;
  rescanButton.textContent = "찾는 중…";
  api.postMessage({ type: "rescan" });
});

input.addEventListener("input", () => {
  renderPreview(input.value);
  api.postMessage({ type: "edit", body: input.value });
  tagComplete.update();
});

// 상단·미리보기의 태그를 누르면 태그로 메모 찾기
for (const el of [tagsEl, previewEl]) {
  el.addEventListener("click", (event) => {
    const tag = (event.target as Element).closest<HTMLElement>(".tag")?.dataset.tag;
    if (tag !== undefined) {
      api.postMessage({ type: "findTag", tag });
    }
  });
}

// 확인창·입력창은 호스트가 띄운다
deleteButton.addEventListener("click", () => api.postMessage({ type: "delete" }));
renameButton.addEventListener("click", () => api.postMessage({ type: "rename" }));

// 제목 편집: 제목을 누르면 같은 자리에 입력칸. Enter·포커스 이탈 = 저장, Esc = 취소. 비우면 호스트가 라벨로 되돌린다
titleEl.addEventListener("click", () => {
  titleInput.value = titleEl.textContent ?? "";
  titleEl.hidden = true;
  titleInput.hidden = false;
  titleInput.focus();
  titleInput.select();
});
titleInput.addEventListener("keydown", (event) => {
  // 한글 조합 중의 Enter는 조합 확정이다
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    titleInput.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    titleInput.value = titleEl.textContent ?? "";
    titleInput.blur();
  }
});
titleInput.addEventListener("blur", () => {
  titleInput.hidden = true;
  titleEl.hidden = false;
  if (titleInput.value !== titleEl.textContent) {
    api.postMessage({ type: "setTitle", title: titleInput.value });
  }
});

previewEl.addEventListener("click", (event) => {
  // 웹뷰 안에서 링크를 따라가면 에디터가 통째로 날아간다
  if (event.target instanceof HTMLAnchorElement) {
    event.preventDefault();
  }
});

window.addEventListener("message", (event: MessageEvent<HostToEditor>) => {
  const message = event.data;
  switch (message.type) {
    case "doc":
      titleEl.textContent = message.title;
      labelEl.textContent = message.label;
      // 제목이 라벨과 같으면 하나만 보인다
      labelEl.hidden = message.title === message.label;
      input.readOnly = false;
      // 같은 값을 다시 넣으면 커서가 끝으로 튄다
      if (input.value !== message.body) {
        input.value = message.body;
      }
      renderPreview(message.body);
      renderAnchors(message.anchors);
      errorEl.hidden = true;
      return;
    case "rescanned":
      rescanButton.disabled = false;
      rescanButton.textContent = "다시 찾기";
      return;
    case "error":
      errorEl.textContent = message.message;
      errorEl.hidden = false;
      input.readOnly = true;
      return;
    case "tags":
      tagComplete.setOthers(message.counts);
      return;
    case "layout":
      splitters.apply(message.layout);
      return;
    case "linkStatus":
      links = { blocks: message.blocks, problems: message.problems };
      linkOpen = message.open;
      renderPreview(input.value);
      return;
    default: {
      const unhandled: never = message;
      console.error("[anchor-notes] unhandled host message", unhandled);
    }
  }
});

api.postMessage({ type: "ready" });

function renderPreview(body: string): void {
  renderTags(body);
  if (body.trim() === "" && links.problems.length === 0) {
    previewEl.classList.add("empty");
    previewEl.textContent = "(빈 메모)";
    return;
  }
  previewEl.classList.remove("empty");
  fenceCount = codeBlocks(body).length;
  // 들여쓰기 코드 블록처럼 tagSpans가 모르는 코드 안에 표시 문자가 남으면 원래 글자로 되돌린다
  const html = marked.parse(markTags(body)) as string;
  previewEl.innerHTML = html.replaceAll(TAG_OPEN, "#").replaceAll(TAG_CLOSE, "");
  decorateLinks();
}

// --- 코드 연결 (R11 C8 메모 에디터 표시 — 안 A 머리 줄 + 펼침 목록) ---

const MARK: Record<LinkState, string> = { synced: "✓", pending: "●", changed: "!", lost: "✕" };
const STATE_TEXT: Record<LinkState, string> = { synced: "동기화됨", pending: "반영 대기", changed: "코드가 바뀜", lost: "코드에서 못 찾음" };

function decorateLinks(): void {
  previewEl.prepend(...links.problems.map(problemBar));
  for (const holder of previewEl.querySelectorAll<HTMLElement>(".code-link")) {
    const block = links.blocks.find((b) => b.key === holder.dataset.key);
    if (block !== undefined) {
      holder.prepend(...linkHead(block));
    }
  }
}

// 미리보기 맨 위 경고 줄: 메모에서 못 찾은 블록
function problemBar(problem: BlockProblem): HTMLElement {
  const bar = el("div", "link-warn");
  const name = problem.key === "" ? "(이름 없음)" : problem.key;
  const what = problem.kind === "duplicate" ? `블록 이름 ${name}이 본문에서 겹칩니다` : problem.key === "" ? "이름 없는 연결은 코드 블록이 하나뿐일 때만 쓸 수 있습니다" : `블록 ${name}을 본문에서 찾을 수 없습니다`;
  bar.append(el("span", "link-warn-mark", "!"), el("span", "link-warn-text", `${what} · 연결 ${problem.anchors.length}곳`));
  bar.append(
    button("블록 다시 고르기", () => api.postMessage({ type: "repickBlock", key: problem.key })),
    button("연결 끊기", () => api.postMessage({ type: "unlink", anchors: problem.anchors })),
  );
  return bar;
}

// 머리 줄 + (펼치면) 연결 목록. 기본 펼침 = ✓ 아닌 연결이 하나라도 있을 때
function linkHead(block: BlockLinks): HTMLElement[] {
  const counts = new Map<LinkState, number>();
  block.rows.forEach((row) => counts.set(row.state, (counts.get(row.state) ?? 0) + 1));
  const open = linkOpen[block.key] ?? block.rows.some((row) => row.state !== "synced");

  const head = el("div", "link-head");
  const toggle = button(open ? "▾" : "▸", () => {
    linkOpen[block.key] = !open;
    api.postMessage({ type: "linkOpen", key: block.key, open: !open });
    renderPreview(input.value);
  });
  toggle.className = "link-toggle";
  toggle.setAttribute("aria-label", open ? "연결 목록 접기" : "연결 목록 펼치기");
  head.append(toggle, el("span", "link-name", block.key === "" ? "(이름 없음)" : block.key), el("span", "link-count", `${block.rows.length}곳 연결`));
  for (const state of ["synced", "pending", "changed", "lost"] as const) {
    const n = counts.get(state);
    if (n !== undefined) {
      head.append(el("span", `link-state ${state}`, `${MARK[state]}${n}`));
    }
  }
  head.append(el("span", "link-gap"));
  const all = button("모두 동기화", () => api.postMessage({ type: "syncBlock", key: block.key }));
  all.className = "link-sync-all";
  all.disabled = !counts.has("pending");
  all.title = all.disabled ? "반영 대기인 연결이 없습니다" : "반영 대기인 연결을 모두 메모 내용으로";
  head.append(all);
  return open ? [head, linkList(block.rows)] : [head];
}

function linkList(rows: LinkRow[]): HTMLElement {
  const list = el("div", "link-list");
  for (const row of rows) {
    const line = el("div", `link-row ${row.state}`);
    const id = row.anchor.kind === "marker" && row.anchor.id !== undefined ? `#${row.anchor.id}` : "";
    const path = button(`${row.anchor.path}${id}`, () => api.postMessage({ type: "openAnchor", anchor: row.anchor }));
    path.className = "link-path";
    path.title = "코드로 이동";
    line.append(el("span", "link-mark", MARK[row.state]), path, el("span", "link-text", STATE_TEXT[row.state]));
    if (row.reason !== undefined) {
      line.append(el("span", "link-reason", row.reason));
    }
    line.append(el("span", "link-gap"), ...rowActions(row));
    list.append(line);
  }
  return list;
}

function rowActions(row: LinkRow): HTMLButtonElement[] {
  const { anchor } = row;
  const open = () => button("열기", () => api.postMessage({ type: "openAnchor", anchor }));
  switch (row.state) {
    case "synced":
      return [open()];
    case "pending":
      return [button("동기화", () => api.postMessage({ type: "syncLink", anchor }), "primary"), open()];
    case "changed":
      return [button("메모로 덮기", () => api.postMessage({ type: "overwrite", anchor })), button("메모에 반영", () => api.postMessage({ type: "adopt", anchor }))];
    case "lost":
      return [button("다시 고르기", () => api.postMessage({ type: "repick", anchor })), open(), button("연결 끊기", () => api.postMessage({ type: "unlink", anchors: [anchor] }))];
  }
}

function button(text: string, onClick: () => void, variant?: "primary"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = variant === "primary" ? "link-btn primary" : "link-btn";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// 이 메모의 태그를 상단에 (저장 전 본문 기준)
function renderTags(body: string): void {
  tagsEl.replaceChildren(
    ...tagsIn(body).map((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.dataset.tag = tag;
      chip.title = "태그로 메모 찾기";
      chip.textContent = `#${tag}`;
      return chip;
    }),
  );
}

// `#태그` -> 표시문자 + 태그 + 표시문자. 뒤에서부터 바꿔 앞쪽 위치가 안 밀리게
function markTags(body: string): string {
  let out = body;
  for (const span of tagSpans(body).reverse()) {
    out = `${out.slice(0, span.start)}${TAG_OPEN}${span.tag}${TAG_CLOSE}${out.slice(span.end)}`;
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 헤더 아래 앵커 칩 줄. 노트 anchors만 보고 그린다(파일을 안 읽음). 칩을 누르면 호스트가 그때 마커 줄을 찾아 연다
function renderAnchors(anchors: Anchor[]): void {
  const chips: HTMLElement[] = anchors.map((anchor) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `anchor-chip ${anchor.kind}`;
    const id = anchor.kind === "marker" && anchor.id !== undefined ? ` #${anchor.id}` : "";
    chip.title = anchor.kind === "file" ? `파일 앵커: ${anchor.path}` : `${anchor.path}${id} 마커로 이동`;
    const cut = anchor.path.lastIndexOf("/") + 1;
    chip.append(span("anchor-dir", anchor.path.slice(0, cut)), span("anchor-base", anchor.path.slice(cut)));
    if (id !== "") {
      chip.append(span("anchor-id", id));
    }
    chip.addEventListener("click", () => api.postMessage({ type: "openAnchor", anchor }));
    return chip;
  });
  if (chips.length === 0) {
    chips.push(span("anchor-none", "앵커가 없습니다"));
  }
  anchorsEl.replaceChildren(...chips, rescanButton);
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`#${id} 가 없습니다`);
  }
  return element as unknown as T;
}
