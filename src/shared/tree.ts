import type { TreeAddition, TreeNode, TreePatch } from "./protocol";

export interface TreeIndexEntry {
  node: TreeNode;
  parentId: string | null;
  depth: number;
}

export type TreeIndex = Map<string, TreeIndexEntry>;

/**
 * 폴더 먼저, 그다음 이름순.
 * 확장과 웹뷰가 **같은 비교 함수**를 써야 한다. 한쪽만 다른 순서로 꽂으면 패치를 적용할수록 두 트리가 어긋난다.
 */
export function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export function buildIndex(root: TreeNode): TreeIndex {
  const index: TreeIndex = new Map();
  const walk = (node: TreeNode, parentId: string | null, depth: number): void => {
    index.set(node.id, { node, parentId, depth });
    for (const child of node.children ?? []) {
      walk(child, node.id, depth + 1);
    }
  };
  walk(root, null, 0);
  return index;
}

export function insertChild(parent: TreeNode, node: TreeNode): void {
  if (parent.children === undefined) {
    parent.children = [];
  }
  let at = 0;
  while (at < parent.children.length && compareNodes(parent.children[at]!, node) < 0) {
    at += 1;
  }
  parent.children.splice(at, 0, node);
}

export function removeChild(parent: TreeNode, id: string): void {
  if (parent.children === undefined) {
    return;
  }
  const at = parent.children.findIndex((child) => child.id === id);
  if (at >= 0) {
    parent.children.splice(at, 1);
  }
}

/** 루트부터 해당 노드까지. breadcrumb에 그대로 쓴다 */
export function ancestorsOf(index: TreeIndex, id: string): TreeNode[] {
  const chain: TreeNode[] = [];
  let cursor: string | null = id;
  while (cursor !== null) {
    const entry: TreeIndexEntry | undefined = index.get(cursor);
    if (entry === undefined) {
      break;
    }
    chain.unshift(entry.node);
    cursor = entry.parentId;
  }
  return chain;
}

/**
 * 이전 색인과 새 트리를 비교해 패치를 만든다.
 * 파일 하나 바뀔 때마다 트리 전체를 보내지 않으려는 것이 목적이므로, 중복은 최대한 걷어낸다.
 */
export function diffTrees(previous: TreeIndex, nextRoot: TreeNode): TreePatch & { nextIndex: TreeIndex } {
  const nextIndex = buildIndex(nextRoot);

  const removedAll: string[] = [];
  for (const id of previous.keys()) {
    if (!nextIndex.has(id)) {
      removedAll.push(id);
    }
  }
  const removedSet = new Set(removedAll);
  // 부모가 이미 제거 목록에 있으면 자식은 보낼 필요가 없다. 받는 쪽이 서브트리째 떼어내기 때문
  const removed = removedAll.filter((id) => {
    const parentId = previous.get(id)?.parentId ?? null;
    return parentId === null || !removedSet.has(parentId);
  });

  const addedIds = new Set<string>();
  for (const id of nextIndex.keys()) {
    if (!previous.has(id)) {
      addedIds.add(id);
    }
  }

  const added: TreeAddition[] = [];
  for (const id of addedIds) {
    const entry = nextIndex.get(id)!;
    if (entry.parentId === null) {
      continue;
    }
    // 부모도 새로 생겼다면 이 노드는 부모의 children에 실려 함께 간다
    if (addedIds.has(entry.parentId)) {
      continue;
    }
    added.push({ parentId: entry.parentId, node: entry.node });
  }
  // 얕은 것부터 꽂아야 자식 추가 시 부모가 이미 존재한다
  added.sort((a, b) => (nextIndex.get(a.node.id)?.depth ?? 0) - (nextIndex.get(b.node.id)?.depth ?? 0));

  return { added, removed, stats: { folderCount: 0, fileCount: 0, truncated: false }, nextIndex };
}

/** 받은 패치를 트리에 적용하고 색인을 다시 만든다 */
export function applyPatch(root: TreeNode, index: TreeIndex, patch: TreePatch): TreeIndex {
  for (const id of patch.removed) {
    const entry = index.get(id);
    if (entry === undefined || entry.parentId === null) {
      continue;
    }
    const parent = index.get(entry.parentId)?.node;
    if (parent !== undefined) {
      removeChild(parent, id);
    }
  }
  for (const addition of patch.added) {
    const parent = index.get(addition.parentId)?.node;
    if (parent !== undefined) {
      insertChild(parent, addition.node);
    }
  }
  // 부분 갱신 대신 전체 재색인. 패치는 디바운스로 드물게 오고, 색인이 어긋나는 쪽이 훨씬 비싸다
  return buildIndex(root);
}
