import { MARKER_WIDTH } from "./layout";
import type { LaidOutLink, LaidOutNode, Layout } from "./layout";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_HIT_HEIGHT = 18;

/**
 * 보이는 노드를 통째로 다시 그린다. 접기/펼치기는 사람 손으로 일어나는 일이라 빈도가 낮다.
 * 노드 수가 예산을 넘어 느려지면 그때 d3 data join으로 바꾼다 (REF-mindmap 4절 레이아웃 캐시).
 */
export function renderMap(host: SVGGElement, layout: Layout, selectedId: string | null): void {
  while (host.firstChild !== null) {
    host.removeChild(host.firstChild);
  }

  const linkLayer = document.createElementNS(SVG_NS, "g");
  linkLayer.setAttribute("class", "link-layer");
  for (const link of layout.links) {
    linkLayer.appendChild(buildLink(link));
  }

  const nodeLayer = document.createElementNS(SVG_NS, "g");
  nodeLayer.setAttribute("class", "node-layer");
  for (const node of layout.nodes) {
    nodeLayer.appendChild(buildNode(node, node.id === selectedId));
  }

  host.appendChild(linkLayer);
  host.appendChild(nodeLayer);
}

function buildLink(link: LaidOutLink): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  const midX = (link.x1 + link.x2) / 2;
  path.setAttribute("class", "link");
  path.setAttribute("d", `M${link.x1},${link.y1}C${midX},${link.y1} ${midX},${link.y2} ${link.x2},${link.y2}`);
  return path;
}

function buildNode(node: LaidOutNode, selected: boolean): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  const classes = ["node", node.kind];
  if (node.collapsed && node.hasChildren) {
    classes.push("collapsed");
  }
  if (selected) {
    classes.push("selected");
  }
  group.setAttribute("class", classes.join(" "));
  group.setAttribute("transform", `translate(${node.x},${node.y})`);
  group.dataset.id = node.id;
  group.dataset.kind = node.kind;

  // 라벨 옆 빈 공간을 눌러도 선택되도록 행 전체를 덮는 투명 판을 먼저 깐다
  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("class", "hit");
  hit.setAttribute("x", "-4");
  hit.setAttribute("y", String(-ROW_HIT_HEIGHT / 2));
  hit.setAttribute("width", String(node.width + 24));
  hit.setAttribute("height", String(ROW_HIT_HEIGHT));
  group.appendChild(hit);

  group.appendChild(node.kind === "folder" ? buildFolderMarker() : buildFileMarker());

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("class", "label");
  label.setAttribute("x", String(MARKER_WIDTH));
  label.setAttribute("dy", "0.32em");
  label.textContent = node.name;
  group.appendChild(label);

  if (node.hiddenCount > 0) {
    const badge = document.createElementNS(SVG_NS, "text");
    badge.setAttribute("class", "badge");
    badge.setAttribute("x", String(node.width + 6));
    badge.setAttribute("dy", "0.32em");
    badge.textContent = String(node.hiddenCount);
    group.appendChild(badge);
  }

  return group;
}

function buildFolderMarker(): SVGRectElement {
  const marker = document.createElementNS(SVG_NS, "rect");
  marker.setAttribute("class", "marker");
  marker.setAttribute("x", "0");
  marker.setAttribute("y", "-5");
  marker.setAttribute("width", "10");
  marker.setAttribute("height", "10");
  marker.setAttribute("rx", "2");
  return marker;
}

function buildFileMarker(): SVGCircleElement {
  const marker = document.createElementNS(SVG_NS, "circle");
  marker.setAttribute("class", "marker");
  marker.setAttribute("cx", "5");
  marker.setAttribute("cy", "0");
  marker.setAttribute("r", "3.5");
  return marker;
}
