import { markersIn } from "./marker";
import type { MarkerHit } from "./marker";

// 한 파일 안 D24(마커 id) 규칙 위반. 유일 범위가 파일 안이라 문서 하나만 보고 끝난다 (6-a 인레이 힌트, 6-b 경고)
export interface MarkerIssue {
  // 0-based 줄
  line: number;
  hit: MarkerHit;
  // bare = 같은 라벨의 id 없는 마커가 앞에 이미 있음, duplicate = 같은 라벨·같은 id가 앞에 이미 있음
  kind: "bare" | "duplicate";
  // 이 파일에서 이 라벨이 쓴 id (파일 순서, 중복 없이). 인레이 힌트 `(used: ...)`
  used: string[];
}

// 첫 번째는 정상, 두 번째부터를 위반으로 낸다
export function markerIssues(lines: readonly string[], prefix: string): MarkerIssue[] {
  const hits = lines.flatMap((text, line) => markersIn(text, prefix).map((hit) => ({ line, hit })));

  const used = new Map<string, string[]>();
  for (const { hit } of hits) {
    const ids = used.get(hit.label) ?? [];
    if (hit.id !== undefined && !ids.includes(hit.id)) {
      ids.push(hit.id);
    }
    used.set(hit.label, ids);
  }

  const seen = new Set<string>();
  const issues: MarkerIssue[] = [];
  for (const { line, hit } of hits) {
    // `#`는 라벨·id에 못 쓰므로 `라벨#id`가 겹치지 않는 키가 된다
    const key = hit.id === undefined ? hit.label : `${hit.label}#${hit.id}`;
    if (seen.has(key)) {
      issues.push({ line, hit, kind: hit.id === undefined ? "bare" : "duplicate", used: used.get(hit.label) ?? [] });
    }
    seen.add(key);
  }
  return issues;
}
