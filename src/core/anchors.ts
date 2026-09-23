import type { Anchor } from "../notes/frontmatter";
import { markersIn } from "./marker";

// 앵커 목록 계산 (R5 마커 스캔). 마커 앵커 단위 = (라벨, 경로) 쌍 하나. 결과가 그대로면 null을 돌려 쓰기를 건너뛴다
// 마커 스캔(저장·다시 찾기)은 marker 앵커만 고친다. file 앵커는 이름 변경·삭제만 따른다 (D25 앵커 종류는 키 이름)

// 파일 한 개에 마커가 있는 라벨들
export function labelsInLines(lines: Iterable<string>, prefix: string): Set<string> {
  const found = new Set<string>();
  for (const line of lines) {
    for (const hit of markersIn(line, prefix)) {
      found.add(hit.label);
    }
  }
  return found;
}

// 파일 하나를 저장했을 때. present = 그 파일에 이 라벨 마커가 있는지
export function syncFileAnchors(anchors: Anchor[], path: string, present: boolean): Anchor[] | null {
  const has = anchors.some((anchor) => isMarkerAt(anchor, path));
  if (present && !has) {
    return [...anchors, { kind: "marker", path }];
  }
  if (!present && has) {
    return anchors.filter((anchor) => !isMarkerAt(anchor, path));
  }
  return null;
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

// 전체 검색 결과(이 라벨 마커가 있는 경로들)에 맞춘다. 남는 앵커는 순서를 유지하고, 새 앵커는 경로순으로 뒤에 붙인다
export function rescanAnchors(anchors: Anchor[], found: Set<string>): Anchor[] {
  const kept = anchors.filter((anchor) => anchor.kind === "file" || found.has(anchor.path));
  const added: Anchor[] = [...found]
    .filter((path) => !kept.some((anchor) => isMarkerAt(anchor, path)))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ kind: "marker", path }));
  return [...kept, ...added];
}

export function sameAnchors(a: Anchor[], b: Anchor[]): boolean {
  return a.length === b.length && a.every((anchor, i) => sameAnchor(anchor, b[i]));
}

// 같은 앵커인지 = 구분 키(종류, 경로)가 같은지
export function sameAnchor(a: Anchor, b: Anchor): boolean {
  return a.kind === b.kind && a.path === b.path;
}

function isMarkerAt(anchor: Anchor, path: string): boolean {
  return anchor.kind === "marker" && anchor.path === path;
}

// path가 dir 자신이거나 그 아래
function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}
