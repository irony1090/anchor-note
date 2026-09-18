import * as vscode from "vscode";
import type { TreeNode, WorkspaceTree } from "../shared/protocol";
import { compareNodes } from "../shared/tree";

/** 이 수를 넘으면 잘라내고 truncated로 알린다. 실측 전 초안값 */
const MAX_FILES = 20000;

/** 메모 저장소가 맵에 파일로 또 나오면 혼란스러우므로 제외한다 (D8 마크다운 저장) */
const NOTES_DIR = ".notemap";

const VIRTUAL_ROOT_ID = "notemap:root";

export async function scanWorkspace(token?: vscode.CancellationToken): Promise<WorkspaceTree | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }

  const roots: TreeNode[] = [];
  let folderCount = 0;
  let fileCount = 0;
  let truncated = false;

  for (const folder of folders) {
    // exclude를 undefined로 두면 files.exclude + search.exclude 설정이 그대로 적용된다.
    // 명시적으로 패턴을 넘기면 그 설정들을 통째로 대체해버리므로 넘기지 않는다.
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*"),
      undefined,
      MAX_FILES + 1,
      token,
    );

    if (uris.length > MAX_FILES) {
      truncated = true;
      uris.length = MAX_FILES;
    }

    const built = buildFolderTree(folder, uris);
    roots.push(built.root);
    folderCount += built.folderCount;
    fileCount += built.fileCount;
  }

  const root: TreeNode =
    roots.length === 1
      ? roots[0]!
      : { id: VIRTUAL_ROOT_ID, name: vscode.workspace.name ?? "workspace", kind: "folder", children: roots };

  return { root, folderCount, fileCount, truncated };
}

function buildFolderTree(
  folder: vscode.WorkspaceFolder,
  uris: vscode.Uri[],
): { root: TreeNode; folderCount: number; fileCount: number } {
  const root: TreeNode = { id: folder.uri.toString(), name: folder.name, kind: "folder", children: [] };
  const folderByPath = new Map<string, TreeNode>();
  let fileCount = 0;

  for (const uri of uris) {
    const relative = relativePath(folder.uri, uri);
    if (relative === null) {
      continue;
    }

    const segments = relative.split("/");
    if (segments[0] === NOTES_DIR) {
      continue;
    }

    const fileName = segments.pop();
    if (fileName === undefined) {
      continue;
    }

    let parent = root;
    let accumulated = "";
    for (const segment of segments) {
      accumulated = accumulated === "" ? segment : `${accumulated}/${segment}`;
      let node = folderByPath.get(accumulated);
      if (node === undefined) {
        // joinPath로 만들어야 경로에 특수문자가 있어도 uri 인코딩이 맞는다
        node = {
          id: vscode.Uri.joinPath(folder.uri, accumulated).toString(),
          name: segment,
          kind: "folder",
          children: [],
        };
        folderByPath.set(accumulated, node);
        parent.children!.push(node);
      }
      parent = node;
    }

    parent.children!.push({ id: uri.toString(), name: fileName, kind: "file" });
    fileCount += 1;
  }

  sortTree(root);
  return { root, folderCount: folderByPath.size, fileCount };
}

function relativePath(base: vscode.Uri, target: vscode.Uri): string | null {
  const prefix = base.path.endsWith("/") ? base.path : `${base.path}/`;
  if (!target.path.startsWith(prefix)) {
    return null;
  }
  return target.path.slice(prefix.length);
}

/**
 * 정렬은 반드시 shared의 compareNodes를 쓴다.
 * 웹뷰가 패치를 꽂을 때 쓰는 비교 함수와 달라지면, 패치를 적용할수록 두 트리의 순서가 어긋난다.
 */
function sortTree(node: TreeNode): void {
  if (node.children === undefined) {
    return;
  }
  node.children.sort(compareNodes);
  for (const child of node.children) {
    sortTree(child);
  }
}

/** 저장된 접힘 상태가 없을 때 쓰는 기본값. 깊은 폴더를 접어서 초기 노드 수를 줄인다 */
export function defaultCollapsed(root: TreeNode, maxExpandedDepth: number): string[] {
  const collapsed: string[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    if (node.children === undefined || node.children.length === 0) {
      return;
    }
    // 접은 노드 아래로도 계속 내려간다. 안 그러면 한 번 펼쳤을 때 그 아래가 통째로 펼쳐져 노드가 폭발한다
    if (depth >= maxExpandedDepth) {
      collapsed.push(node.id);
    }
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return collapsed;
}
