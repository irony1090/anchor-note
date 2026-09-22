// 메모 에디터 웹뷰 (R4 메모 에디터) — 위 미리보기, 아래 입력. 미리보기는 입력마다 호스트 왕복 없이 다시 그린다

import { marked } from "marked";
import type { CodeBlock, EditorToHost, HostToEditor } from "../src/editor/protocol";

interface VsCodeApi {
  postMessage(message: EditorToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// 생 HTML은 버린다
marked.use({ gfm: true, renderer: { html: () => "" } });

const api = acquireVsCodeApi();
const titleEl = byId<HTMLSpanElement>("title");
const labelEl = byId<HTMLSpanElement>("label");
const toggle = byId<HTMLInputElement>("show-code");
const codeEl = byId<HTMLElement>("code");
const previewEl = byId<HTMLElement>("preview");
const errorEl = byId<HTMLParagraphElement>("error");
const input = byId<HTMLTextAreaElement>("input");
const deleteButton = byId<HTMLButtonElement>("delete");

const saved = api.getState() as { showCode?: boolean } | undefined;
toggle.checked = saved?.showCode === true;

input.addEventListener("input", () => {
  renderPreview(input.value);
  api.postMessage({ type: "edit", body: input.value });
});

// 확인창은 호스트가 띄운다
deleteButton.addEventListener("click", () => api.postMessage({ type: "delete" }));

toggle.addEventListener("change", () => {
  api.setState({ showCode: toggle.checked });
  syncCode();
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
      input.readOnly = false;
      // 같은 값을 다시 넣으면 커서가 끝으로 튄다
      if (input.value !== message.body) {
        input.value = message.body;
      }
      renderPreview(message.body);
      errorEl.hidden = true;
      return;
    case "code":
      renderCode(message.blocks);
      return;
    case "error":
      errorEl.textContent = message.message;
      errorEl.hidden = false;
      input.readOnly = true;
      return;
    default: {
      const unhandled: never = message;
      console.error("[note-map] unhandled host message", unhandled);
    }
  }
});

api.postMessage({ type: "ready" });
syncCode();

function syncCode(): void {
  codeEl.hidden = !toggle.checked;
  if (toggle.checked) {
    api.postMessage({ type: "requestCode" });
  }
}

function renderPreview(body: string): void {
  if (body.trim() === "") {
    previewEl.classList.add("empty");
    previewEl.textContent = "(빈 메모)";
    return;
  }
  previewEl.classList.remove("empty");
  previewEl.innerHTML = marked.parse(body) as string;
}

function renderCode(blocks: CodeBlock[]): void {
  codeEl.replaceChildren();
  if (blocks.length === 0) {
    const none = document.createElement("p");
    none.className = "code-none";
    none.textContent = "앵커가 없습니다";
    codeEl.appendChild(none);
    return;
  }

  for (const block of blocks) {
    const wrap = document.createElement("div");
    wrap.className = "code-block";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "code-path";
    head.textContent = block.focus === null ? block.path : `${block.path}:${block.focus + 1}`;
    head.title = "에디터에서 열기";
    head.addEventListener("click", () =>
      api.postMessage({ type: "reveal", path: block.path, line: block.focus ?? block.start }),
    );
    wrap.appendChild(head);

    if (block.missing !== undefined) {
      const warn = document.createElement("p");
      warn.className = "code-missing";
      warn.textContent = block.missing;
      wrap.appendChild(warn);
    }

    const pre = document.createElement("pre");
    block.lines.forEach((text, i) => {
      const lineNo = block.start + i;
      const row = document.createElement("div");
      row.className = `code-line${lineNo === block.focus ? " focus" : ""}`;
      const num = document.createElement("span");
      num.className = "code-num";
      num.textContent = String(lineNo + 1);
      row.appendChild(num);
      row.appendChild(document.createTextNode(text));
      pre.appendChild(row);
    });
    wrap.appendChild(pre);
    codeEl.appendChild(wrap);
  }
}

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`#${id} 가 없습니다`);
  }
  return element as unknown as T;
}
