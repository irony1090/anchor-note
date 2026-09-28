// 마크다운 줄을 펜스 코드 블록 기준으로 나눈다. 태그(R8)와 코드 블록(R11 C1)이 이 함수 하나를 쓴다 — 규칙이 갈라지면 태그 목록과 블록 목록이 어긋난다

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

// text = 펜스 밖 / open·close = 펜스 줄 / code = 펜스 안
export type LineKind = "text" | "open" | "code" | "close";

export interface MdLine {
  // 줄바꿈과 끝의 `\r`을 뺀 내용
  text: string;
  // 원문에서 줄이 시작하는 위치
  start: number;
  kind: LineKind;
  // open 줄만: 펜스 앞 공백 수, info 문자열(앞뒤 공백 제거)
  indent?: number;
  info?: string;
}

export function markdownLines(markdown: string): MdLine[] {
  const lines: MdLine[] = [];
  let fence: string | null = null;
  let offset = 0;

  for (const raw of markdown.split("\n")) {
    const start = offset;
    offset += raw.length + 1;
    // `.`은 `\r`에 맞지 않으므로 먼저 뗀다
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const match = FENCE.exec(text);

    if (fence !== null) {
      // 여는 펜스와 같은 문자, 같거나 긴 길이, 뒤에 공백만 있으면 닫힌다
      const closes = match !== null && match[2][0] === fence[0] && match[2].length >= fence.length && match[3].trim() === "";
      lines.push({ text, start, kind: closes ? "close" : "code" });
      if (closes) {
        fence = null;
      }
      continue;
    }
    if (match !== null) {
      fence = match[2];
      lines.push({ text, start, kind: "open", indent: match[1].length, info: match[3].trim() });
      continue;
    }
    lines.push({ text, start, kind: "text" });
  }
  return lines;
}
