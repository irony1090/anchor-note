// 메모 에디터 웹뷰 (R4 메모 에디터) — 위 미리보기, 아래 입력. 미리보기는 입력마다 호스트 왕복 없이 다시 그린다

import { marked } from "marked";
import { tagSpans, tagsIn } from "../src/core/tag";
import type { EditorToHost, HostToEditor } from "../src/editor/protocol";
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

// 생 HTML은 버린다
marked.use({
  gfm: true,
  renderer: { html: () => "" },
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
    default: {
      const unhandled: never = message;
      console.error("[anchor-notes] unhandled host message", unhandled);
    }
  }
});

api.postMessage({ type: "ready" });

function renderPreview(body: string): void {
  renderTags(body);
  if (body.trim() === "") {
    previewEl.classList.add("empty");
    previewEl.textContent = "(빈 메모)";
    return;
  }
  previewEl.classList.remove("empty");
  // 들여쓰기 코드 블록처럼 tagSpans가 모르는 코드 안에 표시 문자가 남으면 원래 글자로 되돌린다
  const html = marked.parse(markTags(body)) as string;
  previewEl.innerHTML = html.replaceAll(TAG_OPEN, "#").replaceAll(TAG_CLOSE, "");
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
