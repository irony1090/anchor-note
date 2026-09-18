import type { TreePatch, WorkspaceTree } from "../shared/protocol";
import { buildIndex, diffTrees } from "../shared/tree";
import type { TreeIndex } from "../shared/tree";
import { scanWorkspace } from "./scanner";

export type RefreshResult =
  | { kind: "unchanged" }
  | { kind: "replaced"; tree: WorkspaceTree | null }
  | { kind: "patched"; patch: TreePatch };

/** 확장 호스트 쪽 트리 정본. 웹뷰가 가진 사본은 여기서 내보내는 패치로만 바뀐다 */
export class TreeStore {
  private tree: WorkspaceTree | null = null;
  private index: TreeIndex = new Map();

  get current(): WorkspaceTree | null {
    return this.tree;
  }

  /**
   * 다시 스캔하고 이전 상태와 비교한다.
   * 파일 이벤트를 하나씩 적용하지 않고 통째로 다시 스캔하는 이유: `findFiles`에 exclude를 넘기지 않아야
   * 사용자의 files.exclude/search.exclude 설정이 적용되는데, 그 판정을 이벤트 단위로 재현할 수가 없다.
   * 스캔은 디바운스 뒤에 한 번만 돌고, 내보내는 건 차이분뿐이라 페이로드는 작다.
   */
  async refresh(): Promise<RefreshResult> {
    const next = await scanWorkspace();

    if (next === null || this.tree === null || next.root.id !== this.tree.root.id) {
      this.tree = next;
      this.index = next === null ? new Map() : buildIndex(next.root);
      return { kind: "replaced", tree: next };
    }

    const diff = diffTrees(this.index, next.root);
    const statsChanged =
      next.folderCount !== this.tree.folderCount ||
      next.fileCount !== this.tree.fileCount ||
      next.truncated !== this.tree.truncated;

    this.tree = next;
    this.index = diff.nextIndex;

    if (diff.added.length === 0 && diff.removed.length === 0 && !statsChanged) {
      return { kind: "unchanged" };
    }

    return {
      kind: "patched",
      patch: {
        added: diff.added,
        removed: diff.removed,
        stats: { folderCount: next.folderCount, fileCount: next.fileCount, truncated: next.truncated },
      },
    };
  }
}
