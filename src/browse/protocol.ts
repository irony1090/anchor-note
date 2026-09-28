// 둘러보기 웹뷰 <-> 확장 호스트 메시지 (R9 둘러보기 페이지)

import type { BrowseNote, MarkerSpot } from "../core/browse";
import type { Anchor } from "../notes/frontmatter";

export type HostToBrowse =
  | { type: "notes"; notes: BrowseNote[] }
  // 노트 없는 마커 (V5). null = 이 세션에 아직 다시 찾기 전
  | { type: "orphans"; spots: MarkerSpot[] | null }
  // 지금 에디터 영역에서 보이는 메모 (목록에서 강조)
  | { type: "active"; label: string | null }
  // 단축키로 열었을 때 검색창에 커서
  | { type: "focusSearch" };

export type BrowseToHost =
  | { type: "ready" }
  | { type: "openNote"; label: string }
  | { type: "openAnchor"; label: string; anchor: Anchor }
  | { type: "openFile"; path: string }
  | { type: "openSpot"; spot: MarkerSpot }
  | { type: "createNote"; spot: MarkerSpot };
