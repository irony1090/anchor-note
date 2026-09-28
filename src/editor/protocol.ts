// 메모 에디터 웹뷰 <-> 확장 호스트 메시지 (R4 메모 에디터)

import type { Anchor } from "../notes/frontmatter";

// 영역 크기. preview·input은 flex 가중치(비율이라 창 크기가 달라도 같게 보인다), anchors는 칩 영역 최대 높이 px(칩 줄 높이는 창과 무관)
export interface Layout {
  anchors: number;
  preview: number;
  input: number;
}

// 코드 연결 하나의 상태 (R11 C8 메모 에디터 표시). lost = 코드에서 못 찾음, reason에 까닭
export type LinkState = "synced" | "pending" | "changed" | "lost";

export interface LinkRow {
  anchor: Anchor;
  state: LinkState;
  reason?: string;
}

// key = 블록 이름. 이름 없는 연결(블록이 하나뿐인 메모)은 ""
export interface BlockLinks {
  key: string;
  rows: LinkRow[];
}

// 메모에서 못 찾은 블록 — 미리보기 맨 위 경고 줄
export interface BlockProblem {
  key: string;
  kind: "missing" | "duplicate";
  anchors: Anchor[];
}

export type HostToEditor =
  // open = 사용자가 접거나 편 블록 (key -> 펼침). 없는 key는 웹뷰가 기본 규칙으로 정한다
  | { type: "linkStatus"; blocks: BlockLinks[]; problems: BlockProblem[]; open: Record<string, boolean> }
  // anchors = 노트 frontmatter 그대로. 파일은 읽지 않는다 (헤더 앵커 칩)
  | { type: "doc"; label: string; title: string; body: string; anchors: Anchor[] }
  | { type: "error"; message: string }
  // 이 메모를 뺀 태그별 메모 수 (R8 태그). 웹뷰가 지금 본문의 태그를 더한다
  | { type: "tags"; counts: Array<[string, number]> }
  | { type: "layout"; layout: Partial<Layout> }
  // 다시 찾기가 끝남(취소·실패 포함). 바뀐 앵커는 doc으로 따로 온다
  | { type: "rescanned" };

export type EditorToHost =
  | { type: "ready" }
  | { type: "edit"; body: string }
  | { type: "openAnchor"; anchor: Anchor }
  // 마커 다시 찾기 (REF-browse 2절)
  | { type: "rescan" }
  | { type: "delete" }
  | { type: "rename" }
  | { type: "setTitle"; title: string }
  | { type: "findTag"; tag: string }
  // R11 C7 동기화 동작. anchor는 linkStatus로 받은 그대로 돌려준다
  | { type: "syncLink"; anchor: Anchor }
  | { type: "syncBlock"; key: string }
  | { type: "overwrite"; anchor: Anchor }
  | { type: "adopt"; anchor: Anchor }
  | { type: "repick"; anchor: Anchor }
  | { type: "repickBlock"; key: string }
  | { type: "unlink"; anchors: Anchor[] }
  | { type: "linkOpen"; key: string; open: boolean }
  | { type: "layout"; layout: Layout };
