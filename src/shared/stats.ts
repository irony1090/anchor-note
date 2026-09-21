/**
 * 메모 수 집계 (W3 집계 캐시). 확장 호스트와 웹뷰가 **같은 코드를 각자 돌린다** (D18 공용 집계 모듈).
 * 집계 결과를 메시지로 보내지 않는 이유는 protocol.ts 아래쪽 주석에 있다.
 *
 * 세는 단위는 마커 출현 수가 아니라 **서로 다른 라벨 수**다 (D15 라벨 단위 집계).
 * 한 메모가 여러 파일에 걸릴 수 있어서(D14 라벨 다중 앵커) 덧셈으로 세면 같은 메모를 여러 번 센다.
 */

import { VIRTUAL_ROOT_ID } from "./protocol";
import type { NoteMeta, TreeNode } from "./protocol";

export interface NoteIndex {
  byLabel: Map<string, NoteMeta>;
  /** 부모 라벨 -> 자식 메모들 */
  childrenOf: Map<string, NoteMeta[]>;
  /** 최상위 메모. 부모가 사라진 메모도 여기 들어간다 */
  roots: NoteMeta[];
  /** 워크스페이스 상대경로 -> 그 자리에 걸린 라벨 + 그 자손 라벨 */
  labelsByPath: Map<string, Set<string>>;
}

/**
 * 앵커가 하나도 없는 **최상위 마커 메모**만 orphan이다.
 * 하위 메모는 원래 마커가 없으므로(REF-notes 3절) 앵커 0개가 정상이고, file 메모는 파일 자체를 가리킨다.
 */
export function isOrphan(note: NoteMeta): boolean {
  return note.kind === "marker" && note.parentLabel === null && note.anchors.length === 0;
}

export function indexNotes(notes: NoteMeta[]): NoteIndex {
  const byLabel = new Map(notes.map((note) => [note.label, note]));
  const childrenOf = new Map<string, NoteMeta[]>();
  const roots: NoteMeta[] = [];

  for (const note of notes) {
    const parent = note.parentLabel;
    if (parent !== null && byLabel.has(parent)) {
      const siblings = childrenOf.get(parent);
      if (siblings === undefined) {
        childrenOf.set(parent, [note]);
      } else {
        siblings.push(note);
      }
    } else {
      // 부모가 사라진 메모를 버리면 어디에도 안 세어진다. 최상위로 올려 센다
      roots.push(note);
    }
  }

  const index: NoteIndex = { byLabel, childrenOf, roots, labelsByPath: new Map() };

  for (const note of notes) {
    if (note.anchors.length === 0) {
      continue;
    }
    const family = familyOf(note, index);
    for (const anchor of note.anchors) {
      const bucket = index.labelsByPath.get(anchor.path);
      if (bucket === undefined) {
        index.labelsByPath.set(anchor.path, new Set(family));
      } else {
        for (const label of family) {
          bucket.add(label);
        }
      }
    }
  }

  return index;
}

/** 자기 자신 + 모든 자손 라벨. 사람이 파일을 고쳐 고리를 만들 수 있으므로 방문 표시로 막는다 */
export function familyOf(note: NoteMeta, index: NoteIndex): Set<string> {
  const seen = new Set<string>([note.label]);
  const queue = [note.label];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const child of index.childrenOf.get(current) ?? []) {
      if (!seen.has(child.label)) {
        seen.add(child.label);
        queue.push(child.label);
      }
    }
  }

  return seen;
}

/**
 * 트리 노드마다 라벨 합집합을 매긴다. 후위 순회 한 번이라 폴더마다 하위를 다시 훑지 않는다.
 * 표시값은 이 집합의 크기다 — 따로 카운트를 들고 있으면 두 값이 어긋난다 (REF-explorer 7절).
 */
export function labelsByNode(root: TreeNode | null, index: NoteIndex): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (root === null) {
    return out;
  }

  if (root.id === VIRTUAL_ROOT_ID) {
    // 가상 루트의 자식들이 각 워크스페이스 폴더의 루트다. 상대경로는 폴더마다 다시 시작한다
    const all = new Set<string>();
    for (const child of root.children ?? []) {
      for (const label of collect(child, "", out, index)) {
        all.add(label);
      }
    }
    out.set(root.id, all);
    return out;
  }

  collect(root, "", out, index);
  return out;
}

function collect(
  node: TreeNode,
  path: string,
  out: Map<string, Set<string>>,
  index: NoteIndex,
): Set<string> {
  const labels = new Set(index.labelsByPath.get(path) ?? []);

  for (const child of node.children ?? []) {
    const childPath = path === "" ? child.name : `${path}/${child.name}`;
    for (const label of collect(child, childPath, out, index)) {
      labels.add(label);
    }
  }

  out.set(node.id, labels);
  return labels;
}

export function orphansIn(labels: Iterable<string>, index: NoteIndex): number {
  let count = 0;
  for (const label of labels) {
    const note = index.byLabel.get(label);
    if (note !== undefined && isOrphan(note)) {
      count += 1;
    }
  }
  return count;
}
