import { markersIn } from "./marker";
import type { MarkerHit } from "./marker";

// 동기화 범위 짝짓기 (R11 C3, D26 범위 닫는 마커). 한 파일 안에서 끝난다

export interface Region {
  label: string;
  id?: string;
  // 여는/닫는 마커가 있는 줄 (0-based). 범위 내용 = 그 사이 줄들
  open: number;
  close: number;
  openHit: MarkerHit;
  closeHit: MarkerHit;
}

export interface RegionIssue {
  line: number;
  hit: MarkerHit;
  // orphan = 짝이 되는 앞선 여는 마커가 없는 닫는 마커, overlap = 범위 안에 다른 범위의 마커가 있음
  kind: "orphan" | "overlap";
}

/**
 * 닫는 마커는 같은 (라벨, id)의 가장 가까운 앞선 여는 마커와 짝이 된다. 여는 마커는 보통 마커와 모양이 같으므로
 * 닫는 마커가 없는 여는 마커는 오류가 아니다 — "닫는 마커가 지워짐"은 연결 정보를 가진 C7(상태 계산)이 판정한다.
 * 같은 줄의 닫는 마커는 범위가 비어 짝이 되지 않는다(orphan).
 * overlap을 막는 이유: 범위 내용을 메모로 갈아 끼우면 안쪽에 있던 다른 범위의 마커가 지워진다.
 */
export function regionsIn(lines: readonly string[], prefix: string): { regions: Region[]; issues: RegionIssue[] } {
  const pending = new Map<string, { line: number; hit: MarkerHit }>();
  const regions: Region[] = [];
  const issues: RegionIssue[] = [];

  lines.forEach((text, line) => {
    for (const hit of markersIn(text, prefix)) {
      const key = hit.id === undefined ? hit.label : `${hit.label}#${hit.id}`;
      const open = pending.get(key);
      if (hit.close !== true) {
        pending.set(key, { line, hit });
      } else if (open === undefined || open.line === line) {
        issues.push({ line, hit, kind: "orphan" });
      } else {
        pending.delete(key);
        const region: Region = { label: hit.label, open: open.line, close: line, openHit: open.hit, closeHit: hit };
        if (hit.id !== undefined) {
          region.id = hit.id;
        }
        regions.push(region);
      }
    }
  });

  for (const outer of regions) {
    const inside = (line: number) => line > outer.open && line < outer.close;
    if (regions.some((other) => other !== outer && (inside(other.open) || inside(other.close)))) {
      issues.push({ line: outer.open, hit: outer.openHit, kind: "overlap" });
    }
  }
  issues.sort((a, b) => a.line - b.line || a.hit.start - b.hit.start);
  return { regions, issues };
}
