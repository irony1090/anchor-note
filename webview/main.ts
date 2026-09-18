import { Explorer } from "./explorer";
import type { ExtensionToWebview, ViewState, WebviewToExtension, WorkspaceTree } from "../src/shared/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

const statusEl = requireElement<HTMLParagraphElement>("status");
const statsEl = requireElement<HTMLSpanElement>("stats");
const nameEl = requireElement<HTMLSpanElement>("workspace-name");
const sortButton = requireElement<HTMLButtonElement>("sort-dir");

const explorer = new Explorer(
  {
    breadcrumb: requireElement<HTMLElement>("breadcrumb"),
    cards: requireElement<HTMLElement>("cards"),
    preview: requireElement<HTMLElement>("preview"),
  },
  {
    onNavigate: (nodeId) => {
      post({ type: "navigate", nodeId });
      refreshToolbar();
    },
    onOpenFile: (nodeId) => post({ type: "openFile", nodeId }),
    // 아래 둘은 P3(메모 CRUD)에서 실제 값을 돌려준다. 지금은 카드의 메모 줄과 프리뷰가 안 그려진다
    getNoteCount: () => undefined,
    getPreview: () => null,
  },
);

sortButton.addEventListener("click", () => {
  const next: ViewState = { ...explorer.getView(), sortAsc: !explorer.getView().sortAsc };
  explorer.setView(next);
  post({ type: "setView", view: next });
  refreshToolbar();
});

window.addEventListener("message", (event: MessageEvent<ExtensionToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      nameEl.textContent = message.workspaceName ?? "Note Map";
      explorer.setView(message.view);
      applyTree(message.tree);
      return;
    case "treeReplaced":
      applyTree(message.tree);
      return;
    case "treePatch":
      explorer.applyTreePatch(message.patch);
      refreshToolbar();
      return;
    case "error":
      setStatus(`오류: ${message.message}`);
      return;
    default: {
      const unhandled: never = message;
      console.error("[note-map] unhandled message", unhandled);
    }
  }
});

post({ type: "ready" });

function applyTree(tree: WorkspaceTree | null): void {
  explorer.setTree(tree);
  if (tree === null) {
    setStatus("열린 워크스페이스가 없습니다");
    return;
  }
  setStatus(null);
  refreshToolbar();
}

function refreshToolbar(): void {
  const tree = explorer.getStats();
  statsEl.textContent =
    tree === null
      ? ""
      : `폴더 ${tree.folderCount} · 파일 ${tree.fileCount}${tree.truncated ? " (일부 생략됨)" : ""}`;
  sortButton.textContent = explorer.getView().sortAsc ? "이름순 A-Z" : "이름순 Z-A";
}

function setStatus(text: string | null): void {
  statusEl.textContent = text ?? "";
  statusEl.hidden = text === null;
}

function post(message: WebviewToExtension): void {
  api.postMessage(message);
}

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`[note-map] #${id} 가 없다`);
  }
  return element as unknown as T;
}
