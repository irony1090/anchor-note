/**
 * `.notemap/notes/{라벨}.md`의 YAML frontmatter 파싱/직렬화 (REF-notes 3절).
 *
 * YAML 라이브러리를 쓰지 않는다. 스키마가 우리 것이고 필드가 고정이라 서브셋으로 충분하다.
 * 대신 **모르는 키는 원문 그대로 보존**해서 사람이 Obsidian에서 덧붙인 필드를 날리지 않고,
 * 아는 키를 못 읽으면 고치지 말고 BrokenNoteError를 던진다 — 사람이 쓴 파일을 추측으로 복구하지 않는다.
 */

import type { Anchor, NoteKind } from "../shared/protocol";

const FENCE = "---";

export interface ParsedNote {
  kind: NoteKind;
  anchors: Anchor[];
  parentLabel: string | null;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
  /** 우리가 모르는 frontmatter 줄. 다시 쓸 때 그대로 돌려놓는다 */
  extra: string[];
}

export class BrokenNoteError extends Error {}

export function parseNote(text: string, label: string): ParsedNote {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) {
    throw new BrokenNoteError("frontmatter가 없다 (첫 줄이 ---가 아님)");
  }

  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    throw new BrokenNoteError("frontmatter가 닫히지 않았다");
  }

  const head = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n/, "");

  const extra: string[] = [];
  let kind: NoteKind = "marker";
  let anchors: Anchor[] = [];
  let parentLabel: string | null = null;
  let title = label;
  let tags: string[] = [];
  let createdAt = "";
  let updatedAt = "";

  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      extra.push(line);
      continue;
    }

    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      throw new BrokenNoteError(`읽을 수 없는 줄: ${line.trim()}`);
    }

    const key = match[1];
    const raw = match[2].trim();

    switch (key) {
      case "label":
        break; // 파일명이 라벨의 정본이다. 어긋나 있으면 다음 저장 때 맞춰진다
      case "kind":
        kind = scalar(raw) === "file" ? "file" : "marker";
        break;
      case "parent":
        parentLabel = raw === "" || raw === "null" || raw === "~" ? null : scalar(raw);
        break;
      case "title":
        title = scalar(raw) || label;
        break;
      case "created":
        createdAt = scalar(raw);
        break;
      case "updated":
        updatedAt = scalar(raw);
        break;
      case "tags": {
        const block = takeBlock(head, i, raw);
        i = block.next;
        tags = block.items.map((item) => scalar(item.trim()));
        break;
      }
      case "anchors": {
        const block = takeBlock(head, i, raw);
        i = block.next;
        anchors = block.maps.map(toAnchor);
        break;
      }
      default:
        extra.push(line);
        // 모르는 키에 딸린 블록도 통째로 보존한다
        while (i + 1 < head.length && isIndented(head[i + 1])) {
          extra.push(head[++i]);
        }
    }
  }

  return { kind, anchors, parentLabel, title, tags, createdAt, updatedAt, body, extra };
}

export function serializeNote(label: string, note: ParsedNote): string {
  const head: string[] = [
    `label: ${emit(label)}`,
    `kind: ${note.kind}`,
    `title: ${emit(note.title)}`,
  ];

  if (note.anchors.length === 0) {
    head.push("anchors: []");
  } else {
    head.push("anchors:");
    for (const anchor of note.anchors) {
      head.push(`  - path: ${emit(anchor.path)}`);
      if (anchor.lineText !== undefined) {
        head.push(`    lineText: ${emit(anchor.lineText)}`);
      }
    }
  }

  head.push(`parent: ${note.parentLabel === null ? "null" : emit(note.parentLabel)}`);
  head.push(`tags: [${note.tags.map(emit).join(", ")}]`);
  head.push(`created: ${note.createdAt}`);
  head.push(`updated: ${note.updatedAt}`);
  head.push(...note.extra);

  const body = note.body === "" || note.body.endsWith("\n") ? note.body : `${note.body}\n`;
  return `${FENCE}\n${head.join("\n")}\n${FENCE}\n${body}`;
}

/** 인용부호를 벗기고 이스케이프를 되돌린다 */
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

/** YAML 겹따옴표 문자열은 JSON 문자열과 이스케이프 규칙이 같아서 JSON.stringify를 그대로 쓴다 */
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
  /** 이 블록이 먹은 마지막 줄의 인덱스 */
  next: number;
  items: string[];
  maps: Array<Map<string, string>>;
}

/** `key: [a, b]` 인라인과 `key:` + `- a` 블록을 모두 받는다 */
function takeBlock(lines: string[], at: number, raw: string): Block {
  if (raw.startsWith("[")) {
    if (!raw.endsWith("]")) {
      throw new BrokenNoteError(`목록이 닫히지 않았다: ${raw}`);
    }
    const inner = raw.slice(1, -1).trim();
    return { next: at, items: inner === "" ? [] : splitInline(inner), maps: [] };
  }
  if (raw !== "") {
    throw new BrokenNoteError(`목록이 와야 하는 자리에 값이 있다: ${raw}`);
  }

  const items: string[] = [];
  const maps: Array<Map<string, string>> = [];
  let i = at;

  while (i + 1 < lines.length && isIndented(lines[i + 1])) {
    const line = lines[++i];
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item) {
      items.push(item[1]);
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

  return { next: i, items, maps };
}

function readPair(text: string, into: Map<string, string>): void {
  const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(text);
  if (pair) {
    into.set(pair[1], pair[2].trim());
  }
}

function splitInline(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote !== null) {
      if (ch === quote && inner[i - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }

  out.push(inner.slice(start));
  return out.map((item) => item.trim()).filter((item) => item !== "");
}

function toAnchor(entry: Map<string, string>): Anchor {
  const path = entry.get("path");
  if (path === undefined) {
    throw new BrokenNoteError("anchors 항목에 path가 없다");
  }
  const lineText = entry.get("lineText");
  return lineText === undefined
    ? { path: scalar(path) }
    : { path: scalar(path), lineText: scalar(lineText) };
}
