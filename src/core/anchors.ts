import type { Anchor } from "../notes/frontmatter";
import { markersIn } from "./marker";

// 앵커 목록 계산 (R5 마커 스캔). 앵커 단위 = (라벨, 경로) 쌍 하나. 결과가 그대로면 null을 돌려 쓰기를 건너뛴다

// 파일 한 개의 라벨 -> 그 라벨 마커가 처음 나온 줄
export function labelsInLines(lines: Iterable<string>, prefix: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of lines) {
    for (const hit of markersIn(line, prefix)) {
      if (!found.has(hit.label)) {
        found.set(hit.label, line);
      }
    }
  }
  return found;
}

// 파일 하나를 저장했을 때. lineText = 그 파일에 이 라벨 마커가 있으면 그 줄, 없으면 undefined
export function syncFileAnchors(anchors: Anchor[], path: string, lineText: string | undefined): Anchor[] | null {
  const has = anchors.some((anchor) => anchor.path === path);
  if (lineText !== undefined && !has) {
    return [...anchors, { path, lineText }];
  }
  if (lineText === undefined && has) {
    return anchors.filter((anchor) => anchor.path !== path);
  }
  // 있는 앵커의 lineText는 고치지 않는다 — 저장할 때마다 노트 파일이 바뀌면 git diff가 시끄러워진다
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
  return moved.filter((anchor, i) => moved.findIndex((other) => other.path === anchor.path) === i);
}

// 파일·폴더 삭제
export function dropAnchors(anchors: Anchor[], path: string): Anchor[] | null {
  const kept = anchors.filter((anchor) => !isUnder(anchor.path, path));
  return kept.length === anchors.length ? null : kept;
}

// 전체 검색 결과(경로 -> 줄)에 맞춘다. 남는 앵커는 순서와 lineText를 유지하고, 새 앵커는 뒤에 붙인다
export function rescanAnchors(anchors: Anchor[], found: Map<string, string>): Anchor[] {
  const kept = anchors.filter((anchor) => found.has(anchor.path));
  const added = [...found]
    .filter(([path]) => !kept.some((anchor) => anchor.path === path))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, lineText]) => ({ path, lineText }));
  return [...kept, ...added];
}

export function samePaths(a: Anchor[], b: Anchor[]): boolean {
  return a.length === b.length && a.every((anchor, i) => anchor.path === b[i].path);
}

// path가 dir 자신이거나 그 아래
function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}
