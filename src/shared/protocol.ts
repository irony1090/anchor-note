/**
 * 확장 호스트와 웹뷰가 함께 import 하는 유일한 메시지 정의 (D5 protocol 공유).
 * 한쪽만 고치면 `npm run typecheck`가 깨지도록 해서, 메시지 이름 오타가 런타임까지 못 가게 한다.
 */

export type TreeNodeKind = "folder" | "file";

/** file 노드의 id는 `uri.toString()` 그대로다. 그대로 파싱해서 열 수 있어야 한다 */
export interface TreeNode {
  id: string;
  name: string;
  kind: TreeNodeKind;
  children?: TreeNode[];
}

export interface TreeStats {
  folderCount: number;
  fileCount: number;
  /** 파일 수 상한에 걸려 일부가 빠졌는지 */
  truncated: boolean;
}

export interface WorkspaceTree extends TreeStats {
  root: TreeNode;
}

/** 부모 id 아래에 node를 통째로 꽂는다. node는 자식까지 달고 온다 */
export interface TreeAddition {
  parentId: string;
  node: TreeNode;
}

export interface TreePatch {
  added: TreeAddition[];
  removed: string[];
  stats: TreeStats;
}

/** 카드를 메모 유무로 거른다 (REF-explorer 4절). 구조로는 안 줄어들고 관련성으로 줄여야 한다 */
export type NoteFilter = "all" | "with" | "without" | "orphan";

/** 탐색기 뷰 상태. workspaceState에 그대로 저장된다 */
export interface ViewState {
  /** 현재 폴더. null이면 워크스페이스 루트 */
  cwdId: string | null;
  sortAsc: boolean;
  noteFilter: NoteFilter;
}

export const DEFAULT_VIEW: ViewState = { cwdId: null, sortAsc: true, noteFilter: "all" };

/** 워크스페이스 폴더가 여럿일 때 씌우는 가상 루트의 id. 실제 파일이 아니다 */
export const VIRTUAL_ROOT_ID = "notemap:root";

/** 메모 저장소 폴더. 스캐너는 이걸 트리에서 빼고 저장소는 여기에 쓴다 — 두 값이 갈라지면 메모가 맵에 파일로 나온다 */
export const NOTES_DIR = ".notemap";

// --- P3(메모 CRUD): 메모 데이터 모델 (REF-notes 3절) ---

export type NoteKind = "marker" | "file";

/**
 * 마커를 본 자리. 라인 번호는 저장하지 않는다 — 줄의 좌표는 코드 안의 마커가 원본이고,
 * 밖에 적어두면 코드가 움직일 때 어긋난다 (D11 코드 라벨 앵커).
 */
export interface Anchor {
  /** 워크스페이스 상대경로. kind=file이면 그 파일 자신 */
  path: string;
  /** 메모를 만든 시점의 그 줄 원문. 지금 줄과 다르면 stale */
  lineText?: string;
}

/**
 * 카드·프리뷰·맵이 쓰는 메타데이터. **본문(body)은 들어 있지 않다.**
 * 메타데이터는 집계에 전부 필요해서 init에 실어 보내지만, 본문까지 실으면
 * 메모가 쌓였을 때 init이 커진다. 본문은 openNote -> noteBody로 한 건씩 받는다.
 */
export interface NoteMeta {
  /** 라벨 하나 = 메모 하나. 노트 파일명이기도 하다 (D12 라벨 전역 유일) */
  label: string;
  kind: NoteKind;
  /** 빈 배열이면 orphan (REF-notes 6절). 여러 개일 수 있다 (D14 라벨 다중 앵커) */
  anchors: Anchor[];
  parentLabel: string | null;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 라벨이 그대로 노트 파일명이 되므로 파일명에 못 쓰는 문자를 막는다 (REF-notes 2절) */
const LABEL_FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/;

/** 확장과 웹뷰가 같은 판정을 써야 해서 여기 둔다 */
export function isValidLabel(label: string): boolean {
  if (label.length === 0 || label !== label.trim()) {
    return false;
  }
  if (label === "." || label === "..") {
    return false;
  }
  return !LABEL_FORBIDDEN.test(label);
}

/** removed는 라벨 목록 */
export interface NotesPatch {
  upserted: NoteMeta[];
  removed: string[];
}

/** 자식 있는 메모를 지울 때 자식 처리 (REF-notes 7절, 기본 promote) */
export type DeleteChildren = "promote" | "delete";

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "navigate"; nodeId: string | null }
  | { type: "openFile"; nodeId: string }
  | { type: "setView"; view: ViewState }
  /** 본문 요청. 응답은 noteBody */
  | { type: "openNote"; label: string }
  /**
   * targetId는 트리 노드 id(파일이면 uri 문자열).
   * line이 있으면 그 줄에 마커를 써넣고(W7 마커 삽입), 없으면 kind=file 메모가 된다.
   * parentLabel이 있으면 하위 메모라 마커를 달지 않는다 (REF-notes 3절).
   */
  | {
      type: "createNote";
      targetId: string;
      line?: number;
      parentLabel?: string | null;
      label: string;
      title: string;
    }
  | { type: "updateNote"; label: string; title?: string; body?: string }
  | { type: "deleteNote"; label: string; children: DeleteChildren }
  /** at은 anchors 배열의 인덱스. 그 자리로 에디터를 보낸다 */
  | { type: "revealAnchor"; label: string; at: number };

export type ExtensionToWebview =
  | {
      type: "init";
      workspaceName: string | null;
      tree: WorkspaceTree | null;
      view: ViewState;
      notes: NoteMeta[];
    }
  | { type: "treeReplaced"; tree: WorkspaceTree | null }
  | { type: "treePatch"; patch: TreePatch }
  | { type: "notesPatch"; patch: NotesPatch }
  | { type: "noteBody"; label: string; body: string }
  | { type: "error"; message: string };

// 메모 수 집계는 메시지에 싣지 않는다 (D18 공용 집계 모듈). 트리와 NoteMeta[]만 보내고
// 카운트는 shared/stats.ts로 양쪽이 각자 계산한다 — 카운트를 보내면 treePatch와 notesPatch가
// 따로 도착하는 순간 화면의 숫자와 트리가 어긋난다.

// --- 아래는 P5(메모 마인드맵)에서 쓴다. P1(트리 렌더 엔진) 코드가 참조하고 있어 남겨둔다 ---

/** 맵의 줌/팬 상태. k는 배율 */
export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, k: 1 };

/** 이 깊이 이상의 노드는 접은 채로 시작한다. 루트가 0 */
export const DEFAULT_EXPANDED_DEPTH = 2;
