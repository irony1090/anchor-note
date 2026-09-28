// 본문 `#태그` 인식 (R8 태그). 규칙은 Obsidian과 맞춘다 — vault REF-tags.md 인식 규칙 표
import { markdownLines } from "./fence";

// 태그 문자 = 글자·숫자·`_`·`-`·`/`(계층)
const TAG = /#([\p{L}\p{N}_\-/]+)/gu;

export interface TagSpan {
  // `#`의 위치
  start: number;
  // 태그 끝 (뒤에 붙은 `/`는 뺀 위치)
  end: number;
  tag: string;
}

/**
 * 본문에서 태그 위치를 전부 찾는다. 메모 목록(저장소)과 미리보기(웹뷰)가 모두 이 함수 하나를 쓴다 —
 * 둘이 규칙을 따로 가지면 미리보기에는 칩으로 보이는데 태그 목록에는 없는 식으로 어긋난다.
 */
export function tagSpans(markdown: string): TagSpan[] {
  const spans: TagSpan[] = [];

  for (const { text: line, start: lineStart, kind } of markdownLines(markdown)) {
    if (kind !== "text") {
      continue; // 펜스 줄과 코드 블록 안
    }

    const masked = maskInlineCode(line);
    for (const match of masked.matchAll(TAG)) {
      const at = match.index;
      // 앞이 줄 시작·공백이어야 한다. `a#b` `(#x)` `\#x` `&#123;` URL의 `/#sec`를 거른다
      if (at > 0 && !/\s/.test(masked[at - 1])) {
        continue;
      }
      const tag = match[1].replace(/\/+$/, "");
      if (tag === "" || tag.startsWith("/") || /^\d+$/.test(tag)) {
        continue; // 숫자만 = 이슈 번호
      }
      spans.push({ start: lineStart + at, end: lineStart + at + 1 + tag.length, tag });
    }
  }
  return spans;
}

// 본문의 태그 (중복 없이, 처음 나온 순서)
export function tagsIn(markdown: string): string[] {
  return [...new Set(tagSpans(markdown).map((span) => span.tag))];
}

// 인라인 코드(백틱 n개 ~ 백틱 n개)를 같은 길이의 공백으로 가린다. 위치를 보존해야 span 좌표가 원문과 맞는다
function maskInlineCode(line: string): string {
  let out = line;
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let j = i;
    while (line[j] === "`") {
      j++;
    }
    const close = closingRun(line, j, j - i);
    if (close === -1) {
      i = j; // 닫는 백틱이 없으면 그냥 글자다
      continue;
    }
    out = `${out.slice(0, i)}${" ".repeat(close - i)}${out.slice(close)}`;
    i = close;
  }
  return out;
}

// from부터 정확히 n개짜리 백틱 묶음을 찾아 그 끝 위치. 없으면 -1
function closingRun(line: string, from: number, n: number): number {
  let k = from;
  while (k < line.length) {
    if (line[k] !== "`") {
      k++;
      continue;
    }
    let m = k;
    while (line[m] === "`") {
      m++;
    }
    if (m - k === n) {
      return m;
    }
    k = m;
  }
  return -1;
}
