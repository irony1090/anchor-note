/**
 * `.notemap/notes/{라벨}.md` frontmatter 서브셋 파서 (D20 서브셋 frontmatter 파서). vscode를 import하지 않는다.
 * 모르는 키는 원문 그대로 보존하고(사람이 Obsidian에서 덧붙인 필드), 아는 키를 못 읽으면 고치지 않고 BrokenNoteError를 던진다.
 * 본문 경계는 `bodyOffset` 하나로 정한다 — 파서와 메모 에디터가 경계를 다르게 보면 본문 앞줄이 사라지거나 늘어난다.
 */

const FENCE = "---";

// 앵커 종류 = frontmatter 키 이름 `- marker:` / `- file:` (D25 앵커 종류는 키 이름). path는 워크스페이스 상대경로 (D8 마크다운 저장)
export type Anchor = { kind: "marker"; path: string; id?: string; link?: CodeLink } | { kind: "file"; path: string };

// 동기화 정보 (D27 동기화 정보는 앵커 항목에). prefix·suffix가 있으면 열 단위, 없으면 줄 단위 — 빈 문자열("")도 "있음"이다
export interface CodeLink {
  // 메모 코드 블록 이름. 없으면 메모에 블록이 하나뿐일 때 그 블록
  block?: string;
  prefix?: string;
  suffix?: string;
  // 마지막으로 맞춘 슬롯 내용의 해시. 없던 항목을 읽으면 "" (어떤 내용과도 안 맞음)
  hash: string;
}

const LINK_KEYS = ["block", "prefix", "suffix", "hash"] as const;

export interface NoteMeta {
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
  const meta: NoteMeta = { title: label, anchors: [], created: "", updated: "", extra: [] };
  // 옛 형식의 노트 단위 kind. `- path:` 항목을 frontmatter를 다 읽은 뒤 변환한다 — kind 줄이 anchors 뒤에 있어도 맞게
  let legacyKind: "marker" | "file" = "marker";
  let entries: Array<Map<string, string>> = [];

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
        // 아는 키로 읽고 버린다. extra로 흘리면 옛 노트에 영원히 남는다
        legacyKind = scalar(raw) === "file" ? "file" : "marker";
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
        entries = block.maps;
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

  meta.anchors = entries.map((entry) => toAnchor(entry, legacyKind));
  return { meta, body: text.slice(split.bodyStart) };
}

// 여는 `---`부터 닫는 `---` 줄바꿈까지. 이 문자열을 [0, bodyOffset) 자리에 그대로 갈아 끼운다
export function serializeMeta(label: string, meta: NoteMeta, eol = "\n"): string {
  const lines = [FENCE, `label: ${emit(label)}`, `title: ${emit(meta.title)}`];

  if (meta.anchors.length === 0) {
    lines.push("anchors: []");
  } else {
    lines.push("anchors:");
    for (const anchor of meta.anchors) {
      lines.push(`  - ${anchor.kind}: ${emit(anchor.path)}`);
      if (anchor.kind === "marker" && anchor.id !== undefined) {
        lines.push(`    id: ${emit(anchor.id)}`);
      }
      if (anchor.kind === "marker" && anchor.link !== undefined) {
        for (const key of LINK_KEYS) {
          const value = anchor.link[key];
          if (value !== undefined) {
            lines.push(`    ${key}: ${emit(value)}`);
          }
        }
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
  // 제어문자(줄바꿈·탭)는 겹따옴표 안에서만 이스케이프된다. 그대로 쓰면 frontmatter 줄이 쪼개진다
  if (value === "" || value !== value.trim() || /[\u0000-\u001f]/.test(value)) {
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

// 새 형식 `- marker:`(+ `id:`) / `- file:`, 옛 형식 `- path:`는 노트의 kind로 종류를 정한다. lineText는 읽고 버린다 (D25 앵커 종류는 키 이름)
function toAnchor(entry: Map<string, string>, legacyKind: "marker" | "file"): Anchor {
  const marker = entry.get("marker");
  const file = entry.get("file");
  if (marker !== undefined && file !== undefined) {
    throw new BrokenNoteError("anchors 항목에 marker와 file이 같이 있다");
  }
  if (file !== undefined) {
    return { kind: "file", path: scalar(file) };
  }
  if (marker !== undefined) {
    const id = scalar(entry.get("id") ?? "");
    const anchor: Anchor = id === "" ? { kind: "marker", path: scalar(marker) } : { kind: "marker", path: scalar(marker), id };
    const link = toLink(entry);
    if (link !== undefined) {
      anchor.link = link;
    }
    return anchor;
  }
  const path = entry.get("path");
  if (path === undefined) {
    throw new BrokenNoteError("anchors 항목에 marker·file·path가 없다");
  }
  return { kind: legacyKind, path: scalar(path) };
}

// 키가 하나라도 있으면 연결. 값은 따옴표를 벗긴 그대로 — 코드 조각이라 공백·`:`·`#`이 흔하다 (emit이 겹따옴표로 쓴다)
function toLink(entry: Map<string, string>): CodeLink | undefined {
  if (!LINK_KEYS.some((key) => entry.has(key))) {
    return undefined;
  }
  const link: CodeLink = { hash: scalar(entry.get("hash") ?? "") };
  for (const key of ["block", "prefix", "suffix"] as const) {
    const raw = entry.get(key);
    if (raw !== undefined) {
      link[key] = scalar(raw);
    }
  }
  return link;
}
