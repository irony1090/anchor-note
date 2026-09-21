/** 메모 에디터(커스텀 에디터) <-> 확장 호스트 메시지. 에디터 주도 프로토타입 전용 */

export interface CodeBlock {
  path: string;
  /** 0-based 첫 줄 번호 */
  start: number;
  lines: string[];
  /** 마커가 있는 줄(0-based). file 메모거나 못 찾으면 null */
  focus: number | null;
  missing?: string;
}

export type HostToEditor =
  | { type: "doc"; label: string; title: string; body: string }
  | { type: "code"; blocks: CodeBlock[] }
  | { type: "error"; message: string };

export type EditorToHost =
  | { type: "ready" }
  | { type: "edit"; body: string }
  | { type: "requestCode" }
  | { type: "reveal"; path: string; line: number };
