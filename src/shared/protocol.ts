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

/** 탐색기 뷰 상태. workspaceState에 그대로 저장된다 */
export interface ViewState {
  /** 현재 폴더. null이면 워크스페이스 루트 */
  cwdId: string | null;
  sortAsc: boolean;
}

export const DEFAULT_VIEW: ViewState = { cwdId: null, sortAsc: true };

export type WebviewToExtension =
  | { type: "ready" }
  | { type: "navigate"; nodeId: string | null }
  | { type: "openFile"; nodeId: string }
  | { type: "setView"; view: ViewState };

export type ExtensionToWebview =
  | { type: "init"; workspaceName: string | null; tree: WorkspaceTree | null; view: ViewState }
  | { type: "treeReplaced"; tree: WorkspaceTree | null }
  | { type: "treePatch"; patch: TreePatch }
  | { type: "error"; message: string };

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
