import { Explorer } from "./explorer";
import type { NoteBadge, PreviewContent, PreviewLine } from "./explorer";
import { NotesPanel } from "./notes-panel";
import { indexNotes, isOrphan, labelsByNode, orphansIn } from "../src/shared/stats";
import type { NoteIndex } from "../src/shared/stats";
import type {
  ExtensionToWebview,
  NoteFilter,
  NoteMeta,
  TreeNode,
  ViewState,
  WebviewToExtension,
  WorkspaceTree,
} from "../src/shared/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

/** 폴더 프리뷰에 몇 줄까지 보여줄지. 실측 전 초안값 */
const PREVIEW_ROWS = 8;

const statusEl = requireElement<HTMLParagraphElement>("status");
const statusText = requireElement<HTMLSpanElement>("status-text");
const statusClose = requireElement<HTMLButtonElement>("status-close");
const statsEl = requireElement<HTMLSpanElement>("stats");
const nameEl = requireElement<HTMLSpanElement>("workspace-name");
const sortButton = requireElement<HTMLButtonElement>("sort-dir");
const filterSelect = requireElement<HTMLSelectElement>("note-filter");

/** 메모 정본은 확장 호스트에 있다. 여기 있는 건 사본이고, notesPatch로만 바뀐다 */
let notes: NoteMeta[] = [];
let index: NoteIndex = indexNotes([]);
let labels = new Map<string, Set<string>>();
/** 패널이 보고 있는 노드. 트리 패치로 노드 객체가 갈릴 수 있어 id로만 들고 있는다 */
let panelTargetId: string | null = null;

const explorer = new Explorer(
  {
    breadcrumb: requireElement<HTMLElement>("breadcrumb"),
    cards: requireElement<HTMLElement>("cards"),
    preview: requireElement<HTMLElement>("preview"),
  },
  {
    onNavigate: (nodeId) => {
      post({ type: "navigate", nodeId });
      closePanel();
      refreshToolbar();
    },
    onOpenFile: (nodeId) => post({ type: "openFile", nodeId }),
    onSelectFile: (node) => openPanel(node),
    getNoteBadge: (node) => badgeFor(node),
    getPreview: (node) => previewFor(node),
  },
);

const panel = new NotesPanel(requireElement<HTMLElement>("note-panel"), {
  onOpenNote: (label) => post({ type: "openNote", label }),
  onCreate: (request) => post({ type: "createNote", ...request }),
  onUpdate: (label, patch) => post({ type: "updateNote", label, ...patch }),
  onDelete: (label, children) => post({ type: "deleteNote", label, children }),
  onReveal: (label, at) => post({ type: "revealAnchor", label, at }),
  onClose: () => {
    closePanel();
    explorer.clearSelection();
  },
});

filterSelect.addEventListener("change", () => {
  const next: ViewState = { ...explorer.getView(), noteFilter: filterSelect.value as NoteFilter };
  explorer.setView(next);
  post({ type: "setView", view: next });
});

sortButton.addEventListener("click", () => {
  const next: ViewState = { ...explorer.getView(), sortAsc: !explorer.getView().sortAsc };
  explorer.setView(next);
  post({ type: "setView", view: next });
  refreshToolbar();
});

statusClose.addEventListener("click", () => setStatus(null));

window.addEventListener("message", (event: MessageEvent<ExtensionToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      nameEl.textContent = message.workspaceName ?? "Note Map";
      // 순서가 중요하다: 트리가 없는 상태에서 setView를 하면 저장해둔 폴더가 "없는 노드"로 판정돼 루트로 튄다
      notes = message.notes;
      index = indexNotes(notes);
      applyTree(message.tree);
      explorer.setView(message.view);
      refreshToolbar();
      return;
    case "treeReplaced":
      applyTree(message.tree);
      return;
    case "treePatch":
      explorer.applyTreePatch(message.patch);
      recount();
      explorer.refreshBadges();
      refreshToolbar();
      return;
    case "notesPatch": {
      const removed = new Set(message.patch.removed);
      const upserted = new Map(message.patch.upserted.map((note) => [note.label, note]));
      const merged = notes
        .filter((note) => !removed.has(note.label) && !upserted.has(note.label))
        .concat(message.patch.upserted);
      panel.invalidate([...upserted.keys()]);
      // 지운 라벨을 invalidate에 넣으면 선택 중인 메모의 본문을 재요청해 "없는 메모" 오류가 난다 (B9)
      panel.forget([...removed]);
      setNotes(merged);
      return;
    }
    case "noteBody":
      panel.setBody(message.label, message.body);
      return;
    case "error":
      setStatus(`오류: ${message.message}`, true);
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
  // 카드는 setTree가 이미 그렸지만 그때는 집계가 없다. 세고 나서 한 번 더 그린다
  recount();
  explorer.refreshBadges();
  refreshPanel();
  if (tree === null) {
    setStatus("열린 워크스페이스가 없습니다");
    return;
  }
  setStatus(null);
  refreshToolbar();
}

function setNotes(next: NoteMeta[]): void {
  notes = next;
  index = indexNotes(notes);
  recount();
  explorer.refreshBadges();
  refreshPanel();
}

/** 트리나 메모가 바뀔 때마다 노드별 라벨 합집합을 다시 센다 (D18 공용 집계 모듈) */
function recount(): void {
  labels = labelsByNode(explorer.getStats()?.root ?? null, index);
}

function badgeFor(node: TreeNode): NoteBadge | undefined {
  const set = labels.get(node.id);
  if (set === undefined) {
    return undefined;
  }
  return { count: set.size, orphans: orphansIn(set, index) };
}

function openPanel(node: TreeNode): void {
  panelTargetId = node.id;
  panel.setTarget(node, index, labels.get(node.id) ?? new Set());
  document.body.classList.add("with-panel");
}

function closePanel(): void {
  panelTargetId = null;
  panel.setTarget(null, index, new Set());
  document.body.classList.remove("with-panel");
}

function refreshPanel(): void {
  if (panelTargetId === null) {
    return;
  }
  const target = findNode(explorer.getStats()?.root ?? null, panelTargetId);
  if (target === null) {
    closePanel();
    return;
  }
  panel.setTarget(target, index, labels.get(target.id) ?? new Set());
}

function findNode(node: TreeNode | null, id: string): TreeNode | null {
  if (node === null) {
    return null;
  }
  if (node.id === id) {
    return node;
  }
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * 파일 카드는 그 파일의 메모 목록, 폴더 카드는 메모가 있는 하위 파일 목록을 보여준다 (REF-explorer 5절).
 * 폴더에서 파일별 숫자의 합은 카드의 합계보다 클 수 있다 — 여러 파일에 걸린 메모는 줄마다 나오지만
 * 합계에서는 한 번만 세기 때문이다 (D15 라벨 단위 집계).
 */
function previewFor(node: TreeNode): PreviewContent | null {
  const set = labels.get(node.id);
  if (set === undefined || set.size === 0) {
    return null;
  }

  if (node.kind === "file") {
    const lines: PreviewLine[] = [];
    for (const note of rootsIn(set)) {
      appendNoteLines(lines, note, set, 0);
    }
    return { title: node.name, lines: lines.slice(0, PREVIEW_ROWS), more: overflow(lines.length) };
  }

  const rows: PreviewLine[] = [];
  collectFiles(node, "", rows);
  rows.sort((a, b) => Number(b.text.trim()) - Number(a.text.trim()));
  return {
    title: `${node.name} (${set.size} notes)`,
    lines: rows.slice(0, PREVIEW_ROWS),
    more: overflow(rows.length),
  };
}

function rootsIn(set: Set<string>): NoteMeta[] {
  return [...set]
    .map((label) => index.byLabel.get(label))
    .filter((note): note is NoteMeta => {
      if (note === undefined) {
        return false;
      }
      return note.parentLabel === null || !set.has(note.parentLabel);
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function appendNoteLines(lines: PreviewLine[], note: NoteMeta, set: Set<string>, depth: number): void {
  lines.push({
    label: isOrphan(note) ? "(!)" : "-",
    text: ` ${note.title}`,
    indent: depth,
    warn: isOrphan(note),
  });
  for (const child of index.childrenOf.get(note.label) ?? []) {
    if (set.has(child.label)) {
      appendNoteLines(lines, child, set, depth + 1);
    }
  }
}

function collectFiles(node: TreeNode, prefix: string, rows: PreviewLine[]): void {
  for (const child of node.children ?? []) {
    const path = prefix === "" ? child.name : `${prefix}/${child.name}`;
    const set = labels.get(child.id);
    if (child.kind === "file") {
      if (set !== undefined && set.size > 0) {
        rows.push({ label: path, text: ` ${set.size}`, indent: 0 });
      }
      continue;
    }
    collectFiles(child, path, rows);
  }
}

function overflow(total: number): number | undefined {
  return total > PREVIEW_ROWS ? total - PREVIEW_ROWS : undefined;
}

function refreshToolbar(): void {
  const tree = explorer.getStats();
  statsEl.textContent =
    tree === null
      ? ""
      : `폴더 ${tree.folderCount} · 파일 ${tree.fileCount}${tree.truncated ? " (일부 생략됨)" : ""}`;
  sortButton.textContent = explorer.getView().sortAsc ? "이름순 A-Z" : "이름순 Z-A";
  filterSelect.value = explorer.getView().noteFilter;
}

/** 오류는 닫을 수 있어야 한다. 닫는 경로가 init뿐이면 세션 내내 남는다 (B8) */
function setStatus(text: string | null, dismissible = false): void {
  statusText.textContent = text ?? "";
  statusEl.hidden = text === null;
  statusClose.hidden = !dismissible;
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
