/**
 * `.notemap/notes/{라벨}.md` frontmatter 서브셋 파서 (D20 서브셋 frontmatter 파서). vscode를 import하지 않는다.
 * 모르는 키는 원문 그대로 보존하고(사람이 Obsidian에서 덧붙인 필드), 아는 키를 못 읽으면 고치지 않고 BrokenNoteError를 던진다.
 * 본문 경계는 `bodyOffset` 하나로 정한다 — 파서와 메모 에디터가 경계를 다르게 보면 본문 앞줄이 사라지거나 늘어난다.
 */

const FENCE = "---";

export type NoteKind = "marker" | "file";

export interface Anchor {
  // 워크스페이스 상대경로 (D8 마크다운 저장)
  path: string;
  // 앵커를 기록한 시점의 그 줄. 위치 찾기에는 안 쓴다 (D11 코드 라벨 앵커)
  lineText?: string;
}

export interface NoteMeta {
  kind: NoteKind;
  title: string;
  anchors: Anchor[];
  created: string;
  updated: string;
  // 모르는 frontmatter 줄. 구형의 parent·tags도 여기로 들어가 그대로 되쓴다
  extra: string[];
}

export interface ParsedNote {
  meta: NoteMeta;
  body: string;
}

export class BrokenNoteError extends Error {}

interface Split {
  head: string[];
  bodyStart: number;
}

// 본문이 시작하는 문자 위치 (닫는 `---` 줄의 줄바꿈 바로 뒤). frontmatter가 없거나 안 닫혔으면 null
export function bodyOffset(text: string): number | null {
  const split = splitNote(text);
  return typeof split === "string" ? null : split.bodyStart;
}

export function parseNote(text: string, label: string): ParsedNote {
  const split = splitNote(text);
  if (typeof split === "string") {
    throw new BrokenNoteError(split);
  }

  const { head } = split;
  const meta: NoteMeta = { kind: "marker", title: label, anchors: [], created: "", updated: "", extra: [] };

  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      meta.extra.push(line);
      continue;
    }

    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      throw new BrokenNoteError(`읽을 수 없는 줄: ${line.trim()}`);
    }
    const raw = match[2].trim();

    switch (match[1]) {
      case "label":
        break; // 파일명이 라벨의 원본이다. 어긋나 있으면 다음 저장 때 맞춰진다
      case "kind":
        meta.kind = scalar(raw) === "file" ? "file" : "marker";
        break;
      case "title":
        meta.title = scalar(raw) || label;
        break;
      case "created":
        meta.created = scalar(raw);
        break;
      case "updated":
        meta.updated = scalar(raw);
        break;
      case "anchors": {
        const block = takeBlock(head, i, raw);
        i = block.next;
        meta.anchors = block.maps.map(toAnchor);
        break;
      }
      default:
        meta.extra.push(line);
        // 모르는 키에 딸린 들여쓴 줄도 통째로 보존한다
        while (i + 1 < head.length && isIndented(head[i + 1])) {
          meta.extra.push(head[++i]);
        }
    }
  }

  return { meta, body: text.slice(split.bodyStart) };
}

// 여는 `---`부터 닫는 `---` 줄바꿈까지. 이 문자열을 [0, bodyOffset) 자리에 그대로 갈아 끼운다
export function serializeMeta(label: string, meta: NoteMeta, eol = "\n"): string {
  const lines = [FENCE, `label: ${emit(label)}`, `kind: ${meta.kind}`, `title: ${emit(meta.title)}`];

  if (meta.anchors.length === 0) {
    lines.push("anchors: []");
  } else {
    lines.push("anchors:");
    for (const anchor of meta.anchors) {
      lines.push(`  - path: ${emit(anchor.path)}`);
      if (anchor.lineText !== undefined) {
        lines.push(`    lineText: ${emit(anchor.lineText)}`);
      }
    }
  }

  if (meta.created !== "") {
    lines.push(`created: ${meta.created}`);
  }
  if (meta.updated !== "") {
    lines.push(`updated: ${meta.updated}`);
  }
  lines.push(...meta.extra, FENCE);
  return `${lines.join(eol)}${eol}`;
}

export function serializeNote(label: string, note: ParsedNote): string {
  return `${serializeMeta(label, note.meta)}${note.body}`;
}

export interface TextSpanEdit {
  start: number;
  end: number;
  text: string;
}

// frontmatter의 `updated:` 줄을 now로 바꾸는 편집. 그 줄이 없으면 닫는 `---` 앞에 넣는다
export function updatedEdit(text: string, now: string): TextSpanEdit | null {
  if (lineAt(text, 0).line.trim() !== FENCE) {
    return null;
  }
  for (let pos = lineAt(text, 0).end; pos < text.length; ) {
    const { line, end } = lineAt(text, pos);
    if (line === FENCE) {
      return { start: pos, end: pos, text: `updated: ${now}${text.includes("\r\n") ? "\r\n" : "\n"}` };
    }
    if (/^updated\s*:/.test(line)) {
      return { start: pos, end: pos + line.length, text: `updated: ${now}` };
    }
    pos = end;
  }
  return null;
}

function splitNote(text: string): Split | string {
  const first = lineAt(text, 0);
  if (first.line.trim() !== FENCE) {
    return "frontmatter가 없다 (첫 줄이 ---가 아님)";
  }

  const head: string[] = [];
  for (let pos = first.end; pos < text.length; ) {
    const { line, end } = lineAt(text, pos);
    if (line === FENCE) {
      return { head, bodyStart: end };
    }
    head.push(line);
    pos = end;
  }
  return "frontmatter가 닫히지 않았다";
}

// from부터 한 줄. line은 줄바꿈(\n, \r\n) 없이, end는 줄바꿈 다음 위치
function lineAt(text: string, from: number): { line: string; end: number } {
  const nl = text.indexOf("\n", from);
  if (nl === -1) {
    return { line: text.slice(from), end: text.length };
  }
  const line = text.slice(from, nl);
  return { line: line.endsWith("\r") ? line.slice(0, -1) : line, end: nl + 1 };
}

// 인용부호를 벗기고 이스케이프를 되돌린다
function scalar(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      throw new BrokenNoteError(`따옴표가 닫히지 않았다: ${raw}`);
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

// YAML 겹따옴표 문자열은 JSON 문자열과 이스케이프 규칙이 같아서 JSON.stringify를 그대로 쓴다
function emit(value: string): string {
  return needsQuote(value) ? JSON.stringify(value) : value;
}

function needsQuote(value: string): boolean {
  if (value === "" || value !== value.trim()) {
    return true;
  }
  if (/^(null|true|false|yes|no|on|off|~)$/i.test(value) || /^[-+]?[\d.]+$/.test(value)) {
    return true;
  }
  return /[:#"'{}[\],&*!|>%@`\\]/.test(value) || value.startsWith("-");
}

function isIndented(line: string): boolean {
  return /^\s+\S/.test(line);
}

interface Block {
  // 이 블록이 먹은 마지막 줄의 인덱스
  next: number;
  maps: Array<Map<string, string>>;
}

// `key: []` 또는 `key:` + `- k: v` 블록. 비어 있지 않은 인라인 목록은 못 읽으니 깨진 파일로 본다 (고쳐 쓰면 내용이 날아간다)
function takeBlock(lines: string[], at: number, raw: string): Block {
  if (raw.startsWith("[")) {
    if (raw.slice(1, -1).trim() !== "" || !raw.endsWith("]")) {
      throw new BrokenNoteError(`인라인 목록은 빈 목록([])만 읽는다: ${raw}`);
    }
    return { next: at, maps: [] };
  }
  if (raw !== "") {
    throw new BrokenNoteError(`목록이 와야 하는 자리에 값이 있다: ${raw}`);
  }

  const maps: Array<Map<string, string>> = [];
  let i = at;
  while (i + 1 < lines.length && isIndented(lines[i + 1])) {
    const line = lines[++i];
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item) {
      const entry = new Map<string, string>();
      maps.push(entry);
      readPair(item[1], entry);
      continue;
    }
    if (maps.length === 0) {
      throw new BrokenNoteError(`목록 항목이 아니다: ${line.trim()}`);
    }
    readPair(line.trim(), maps[maps.length - 1]);
  }
  return { next: i, maps };
}

function readPair(text: string, into: Map<string, string>): void {
  const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
  if (pair) {
    into.set(pair[1], pair[2].trim());
  }
}

function toAnchor(entry: Map<string, string>): Anchor {
  const path = entry.get("path");
  if (path === undefined) {
    throw new BrokenNoteError("anchors 항목에 path가 없다");
  }
  const lineText = entry.get("lineText");
  return lineText === undefined ? { path: scalar(path) } : { path: scalar(path), lineText: scalar(lineText) };
}
