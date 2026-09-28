import type { Anchor } from "../notes/frontmatter";
import { markersIn } from "./marker";

// 앵커 목록 계산 (R5 마커 스캔). 마커 앵커 단위 = (경로, id) — id 없는 마커는 파일마다 하나 (D24 마커 id). 결과가 그대로면 null을 돌려 쓰기를 건너뛴다
// 마커 스캔(저장·다시 찾기)은 marker 앵커만 고친다. file 앵커는 이름 변경·삭제만 따른다 (D25 앵커 종류는 키 이름)

// 한 파일 안 마커의 id들. id 없는 마커는 undefined. 순서는 파일에 처음 나온 순서, 같은 id가 여럿이어도 하나 (위반은 6-b(경고)가 알린다)
export type MarkerIds = ReadonlySet<string | undefined>;

// 파일 한 개의 라벨 -> 그 라벨 마커의 id들
export function labelsInLines(lines: Iterable<string>, prefix: string): Map<string, Set<string | undefined>> {
  const found = new Map<string, Set<string | undefined>>();
  for (const line of lines) {
    for (const hit of markersIn(line, prefix)) {
      const ids = found.get(hit.label) ?? new Set<string | undefined>();
      ids.add(hit.id);
      found.set(hit.label, ids);
    }
  }
  return found;
}

// 파일 하나를 저장했을 때. ids = 그 파일에 있는 이 라벨 마커의 id들 (없으면 빈 집합)
export function syncFileAnchors(anchors: Anchor[], path: string, ids: MarkerIds): Anchor[] | null {
  const kept = anchors.filter((anchor) => anchor.kind === "file" || anchor.path !== path || ids.has(anchor.id));
  const added = [...ids].filter((id) => !kept.some((anchor) => isMarker(anchor, path, id))).map((id) => markerAnchor(path, id));
  const next = [...kept, ...added];
  return sameAnchors(anchors, next) ? null : next;
}

// 파일·폴더 이름 변경. 옮긴 결과가 기존 앵커와 겹치면 하나로 합친다
export function renameAnchors(anchors: Anchor[], from: string, to: string): Anchor[] | null {
  if (!anchors.some((anchor) => isUnder(anchor.path, from))) {
    return null;
  }
  const moved = anchors.map((anchor) =>
    isUnder(anchor.path, from) ? { ...anchor, path: `${to}${anchor.path.slice(from.length)}` } : anchor,
  );
  return moved.filter((anchor, i) => moved.findIndex((other) => sameAnchor(other, anchor)) === i);
}

// 파일·폴더 삭제
export function dropAnchors(anchors: Anchor[], path: string): Anchor[] | null {
  const kept = anchors.filter((anchor) => !isUnder(anchor.path, path));
  return kept.length === anchors.length ? null : kept;
}

// 전체 검색 결과(경로 -> 이 라벨 마커의 id들)에 맞춘다. 남는 앵커는 순서를 유지하고, 새 앵커는 경로순(같은 경로는 파일 순서)으로 뒤에 붙인다
export function rescanAnchors(anchors: Anchor[], found: ReadonlyMap<string, MarkerIds>): Anchor[] {
  const kept = anchors.filter((anchor) => anchor.kind === "file" || found.get(anchor.path)?.has(anchor.id) === true);
  const added = [...found]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, ids]) => [...ids].filter((id) => !kept.some((anchor) => isMarker(anchor, path, id))).map((id) => markerAnchor(path, id)));
  return [...kept, ...added];
}

export function sameAnchors(a: Anchor[], b: Anchor[]): boolean {
  return a.length === b.length && a.every((anchor, i) => sameAnchor(anchor, b[i]));
}

// 같은 앵커인지 = 구분 키(종류, 경로, id)가 같은지
export function sameAnchor(a: Anchor, b: Anchor): boolean {
  return a.kind === b.kind && a.path === b.path && idOf(a) === idOf(b);
}

export function markerAnchor(path: string, id: string | undefined): Anchor {
  return id === undefined ? { kind: "marker", path } : { kind: "marker", path, id };
}

export function fileAnchor(path: string): Anchor {
  return { kind: "file", path };
}

// 경로 -> 그 파일에 file 앵커를 둔 라벨들 (라벨순). CodeLens·탐색기 배지·떼기가 쓴다 (REF-file-anchor)
export function fileAnchorIndex(notes: Iterable<{ label: string; anchors: readonly Anchor[] }>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { label, anchors } of notes) {
    for (const anchor of anchors) {
      if (anchor.kind === "file") {
        const labels = index.get(anchor.path) ?? [];
        if (!labels.includes(label)) {
          labels.push(label);
        }
        index.set(anchor.path, labels);
      }
    }
  }
  for (const labels of index.values()) {
    labels.sort((a, b) => a.localeCompare(b));
  }
  return index;
}

// 이 경로의 file 앵커를 뺀다. 없으면 null. marker 앵커는 그대로 (F6 파일에서 떼기)
export function dropFileAnchor(anchors: Anchor[], path: string): Anchor[] | null {
  const kept = anchors.filter((anchor) => anchor.kind !== "file" || anchor.path !== path);
  return kept.length === anchors.length ? null : kept;
}

// 이 경로·이 id의 marker 앵커인지 (id undefined = id 없는 마커)
function isMarker(anchor: Anchor, path: string, id: string | undefined): boolean {
  return anchor.kind === "marker" && anchor.path === path && anchor.id === id;
}

function idOf(anchor: Anchor): string | undefined {
  return anchor.kind === "marker" ? anchor.id : undefined;
}

// path가 dir 자신이거나 그 아래
export function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}
