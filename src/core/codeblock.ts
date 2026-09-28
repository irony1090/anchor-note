// 본문의 펜스 코드 블록 목록 (R11 C1 코드 블록 읽기). 블록 이름 = info 둘째 단어 (` ```c baud `) — vault REF-code-sync.md 1절
import { markdownLines } from "./fence";
import { isValidLabel } from "./label";

export interface CodeBlock {
  // info 첫 단어
  lang?: string;
  // info 둘째 단어. 라벨 규칙(isValidLabel)을 통과할 때만 이름이다
  name?: string;
  // 펜스 안 내용. 줄바꿈은 `\n`, 줄마다 펜스 들여쓰기만큼 앞 공백을 뗀다. 줄마다 끝에 `\n`
  content: string;
  // 원문에서 내용이 차지하는 범위 [start, end). end = 닫는 펜스 줄 시작 (안 닫혔으면 원문 끝)
  start: number;
  end: number;
  closed: boolean;
}

export function codeBlocks(markdown: string): CodeBlock[] {
  const lines = markdownLines(markdown);
  const blocks: CodeBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i];
    if (open.kind !== "open") {
      continue;
    }
    const [lang, name] = (open.info ?? "").split(/\s+/);
    const indent = new RegExp(`^ {0,${open.indent ?? 0}}`);

    let content = "";
    let j = i + 1;
    // 원문이 줄바꿈으로 끝나면 split이 남기는 마지막 빈 조각은 줄이 아니다
    while (j < lines.length && lines[j].kind === "code" && lines[j].start < markdown.length) {
      content += `${lines[j].text.replace(indent, "")}\n`;
      j++;
    }
    const closed = j < lines.length && lines[j].kind === "close";
    const start = i + 1 < lines.length ? Math.min(lines[i + 1].start, markdown.length) : markdown.length;
    const end = closed ? lines[j].start : markdown.length;

    const block: CodeBlock = { content, start, end, closed };
    if (lang) {
      block.lang = lang;
    }
    if (name !== undefined && isValidLabel(name)) {
      block.name = name;
    }
    blocks.push(block);
    i = j;
  }
  return blocks;
}

// 두 번 이상 나온 블록 이름 (처음 나온 순서). 연결은 이름으로 찾으므로 겹치면 어느 블록인지 정할 수 없다
export function duplicateBlockNames(blocks: readonly CodeBlock[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { name } of blocks) {
    if (name !== undefined) {
      (seen.has(name) ? dup : seen).add(name);
    }
  }
  return [...dup];
}
