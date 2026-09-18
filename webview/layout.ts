import { hierarchy, tree } from "d3-hierarchy";
import type { TreeNode, TreeNodeKind } from "../src/shared/protocol";

const ROW_HEIGHT = 20;
const COLUMN_GAP = 32;

/** 노드 왼쪽 마커가 차지하는 폭. 라벨은 이만큼 오른쪽에서 시작한다 */
export const MARKER_WIDTH = 16;

export interface LaidOutNode {
  id: string;
  name: string;
  kind: TreeNodeKind;
  depth: number;
  x: number;
  y: number;
  width: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** 접혀서 안 보이는 직속 자식 수. 0이면 뱃지를 안 그린다 */
  hiddenCount: number;
  parentId: string | null;
}

export interface LaidOutLink {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  nodes: LaidOutNode[];
  links: LaidOutLink[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Measure = (text: string) => number;

export function layoutTree(root: TreeNode, collapsed: ReadonlySet<string>, measure: Measure): Layout {
  // children 접근자가 undefined를 돌려주면 d3는 그 노드를 잎으로 본다. 접힘이 곧 잎 처리가 된다
  const rootNode = hierarchy<TreeNode>(root, (datum) =>
    collapsed.has(datum.id) ? undefined : datum.children,
  );

  // nodeSize의 두 번째 값(깊이 간격)은 아래에서 깊이별 최대 라벨 폭으로 덮어쓰므로 1로 둔다
  const positioned = tree<TreeNode>().nodeSize([ROW_HEIGHT, 1])(rootNode);

  const widthByDepth: number[] = [];
  positioned.each((node) => {
    const width = MARKER_WIDTH + measure(node.data.name);
    widthByDepth[node.depth] = Math.max(widthByDepth[node.depth] ?? 0, width);
  });

  // 깊이마다 열 시작 x를 누적으로 잡는다. 고정 폭이면 긴 파일명이 다음 열을 침범한다
  const columnX: number[] = [];
  let accumulated = 0;
  for (let depth = 0; depth < widthByDepth.length; depth += 1) {
    columnX[depth] = accumulated;
    accumulated += (widthByDepth[depth] ?? 0) + COLUMN_GAP;
  }

  const nodes: LaidOutNode[] = [];
  const links: LaidOutLink[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  positioned.each((node) => {
    const x = columnX[node.depth] ?? 0;
    // d3 tree는 x가 폭 방향, y가 깊이 방향이다. 가로 트리라 화면에서는 뒤집어 쓴다
    const y = node.x;
    const width = MARKER_WIDTH + measure(node.data.name);
    const children = node.data.children;
    const isCollapsed = collapsed.has(node.data.id);

    nodes.push({
      id: node.data.id,
      name: node.data.name,
      kind: node.data.kind,
      depth: node.depth,
      x,
      y,
      width,
      hasChildren: children !== undefined && children.length > 0,
      collapsed: isCollapsed,
      hiddenCount: isCollapsed && children !== undefined ? children.length : 0,
      parentId: node.parent === null ? null : node.parent.data.id,
    });

    if (node.parent !== null) {
      const parentRight =
        (columnX[node.parent.depth] ?? 0) + MARKER_WIDTH + measure(node.parent.data.name);
      links.push({ id: node.data.id, x1: parentRight, y1: node.parent.x, x2: x, y2: y });
    }

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  if (nodes.length === 0) {
    return { nodes, links, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { nodes, links, minX, minY: minY - ROW_HEIGHT, maxX, maxY: maxY + ROW_HEIGHT };
}
