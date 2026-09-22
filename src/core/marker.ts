import { isLabelChars, isValidLabel } from "./label";

export interface MarkerHit {
  label: string;
  start: number;
  end: number;
}

export const DEFAULT_PREFIX = "@note:";

export function markerText(label: string, prefix: string): string {
  return `${prefix}${label}`;
}

/**
 * 한 줄에서 마커를 전부 찾는다. hover·단축키·스캔·삭제·자동완성이 모두 이 함수 하나만 쓴다.
 * 규칙: prefix 뒤 공백 전까지의 덩어리가 유효한 라벨이어야 마커다. 그래서 `@note:a`가 `@note:ab`에 걸리지 않고,
 * 인용(`` `@note:a` ``)이나 문장 끝(`@note:a.`)은 마커가 아니다 — 경계 규칙이 갈라지면 hover는 보이는데 삭제는 안 되는 식으로 어긋난다.
 */
export function markersIn(line: string, prefix: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  const pattern = new RegExp(`${escapeRegExp(prefix)}(\\S+)`, "g");
  for (const match of line.matchAll(pattern)) {
    const label = match[1];
    if (isValidLabel(label)) {
      const start = match.index;
      hits.push({ label, start, end: start + match[0].length });
    }
  }
  return hits;
}

export interface PartialMarker {
  // 라벨 일부가 시작하는 위치 (prefix 바로 뒤)
  start: number;
  partial: string;
}

// 커서 앞 텍스트가 `prefix + 라벨 일부`로 끝나면 그 일부. 자동완성(R6)이 쓴다. 경계 규칙은 markersIn과 같다(앞쪽 경계 없음)
export function partialMarkerAt(before: string, prefix: string): PartialMarker | null {
  const at = before.lastIndexOf(prefix);
  if (at === -1) {
    return null;
  }
  const start = at + prefix.length;
  const partial = before.slice(start);
  return isLabelChars(partial) ? { start, partial } : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
