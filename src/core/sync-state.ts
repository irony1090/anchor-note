// 연결 상태 계산과 반영 계획 (R11 C7 상태 계산·동기화 동작) — vault REF-code-sync-ui 1절
import type { CodeLink } from "../notes/frontmatter";
import type { CodeBlock } from "./codeblock";
import { markersIn } from "./marker";
import { regionsIn } from "./region";
import type { Region } from "./region";
import { blockValue, dedentLines, indentLines, locateSlot, replaceSlot, slotHash } from "./slot";

// 코드와 메모를 둘 다 찾았을 때의 상태. 못 찾은 쪽은 SlotMiss / BlockMiss로 따로 나온다
export type SyncState = "synced" | "pending" | "changed";

// slot = 코드 쪽 비교 값, block = blockValue(블록 내용), hash = 마지막으로 맞춘 슬롯 (D28 메모 -> 코드, 반영은 버튼)
export function classify(slot: string, block: string, hash: string): SyncState {
  if (slot === block) {
    return "synced";
  }
  return slotHash(slot) === hash ? "pending" : "changed";
}

export type BlockMiss = "missing" | "duplicate";

// 연결이 가리키는 블록. 이름 없는 연결은 블록이 하나뿐일 때만 (vault REF-code-sync 6절)
export function findBlock(blocks: readonly CodeBlock[], name: string | undefined): CodeBlock | BlockMiss {
  if (name === undefined) {
    return blocks.length === 1 ? blocks[0] : "missing";
  }
  const hits = blocks.filter((block) => block.name === name);
  if (hits.length === 0) {
    return "missing";
  }
  return hits.length === 1 ? hits[0] : "duplicate";
}

export interface Pos {
  line: number;
  character: number;
}

export interface Slot {
  region: Region;
  // prefix·suffix가 있으면 열 단위
  column: boolean;
  // 비교 값. 줄 단위는 여는 마커 들여쓰기를 뗀 줄들, 열 단위는 슬롯 글자 그대로
  text: string;
  // 파일에서 바꿀 자리 [from, to). 줄 단위는 범위 사이 줄 전체(닫는 마커 줄 맨 앞까지)
  from: Pos;
  to: Pos;
  // 줄 단위: 여는 마커 줄의 들여쓰기 / 열 단위: 범위 사이 줄들을 `\n`으로 이은 글자
  indent: string;
  regionText: string;
  // 바꿀 자리 안의 마커 수. 반영하면 지워진다 (C3에서 발견 — 범위 안 다른 라벨 보통 마커)
  markers: number;
}

// no-region = 여는·닫는 마커 짝 없음, overlap = 범위가 다른 범위와 겹침, missing·ambiguous = 문맥으로 슬롯을 못 찾음
export type SlotMiss = "no-region" | "overlap" | "missing" | "ambiguous";

// 파일 줄들에서 연결의 슬롯을 찾는다. 겹친 범위는 반영하면 안쪽 마커가 지워지므로 못 찾음으로 본다
export function findSlot(lines: readonly string[], markerPrefix: string, label: string, id: string | undefined, link: CodeLink): Slot | SlotMiss {
  const { regions, issues } = regionsIn(lines, markerPrefix);
  const region = regions.find((r) => r.label === label && r.id === id);
  if (region === undefined) {
    return "no-region";
  }
  if (issues.some((issue) => issue.kind === "overlap" && issue.line === region.open)) {
    return "overlap";
  }
  const inner = lines.slice(region.open + 1, region.close);
  const regionText = inner.join("\n");
  const indent = /^\s*/.exec(lines[region.open])?.[0] ?? "";

  if (link.prefix === undefined && link.suffix === undefined) {
    return {
      region,
      column: false,
      text: dedentLines(inner, indent),
      from: { line: region.open + 1, character: 0 },
      to: { line: region.close, character: 0 },
      indent,
      regionText,
      markers: countMarkers(inner, markerPrefix),
    };
  }

  const at = locateSlot(regionText, { prefix: link.prefix ?? "", suffix: link.suffix ?? "" });
  if (typeof at === "string") {
    return at;
  }
  const text = regionText.slice(at.start, at.end);
  return {
    region,
    column: true,
    text,
    from: posIn(region.open + 1, regionText, at.start),
    to: posIn(region.open + 1, regionText, at.end),
    indent,
    regionText,
    markers: countMarkers(text.split("\n"), markerPrefix),
  };
}

// 메모 -> 코드 반영 글자 (`\n` 줄바꿈, 부르는 쪽이 파일 줄바꿈으로 바꾼다). 열 단위 값에 문맥이 섞여 다음 찾기가 어긋나면 unsafe
export function syncText(slot: Slot, link: CodeLink, content: string): string | "unsafe" {
  if (!slot.column) {
    return indentLines(content, slot.indent)
      .map((line) => `${line}\n`)
      .join("");
  }
  const value = blockValue(content);
  const replaced = replaceSlot(slot.regionText, { prefix: link.prefix ?? "", suffix: link.suffix ?? "" }, value);
  return typeof replaced === "string" ? "unsafe" : value;
}

// 반영 뒤 기록할 hash. 반영된 슬롯의 비교 값 = blockValue(내용)
export function syncedHash(content: string): string {
  return slotHash(blockValue(content));
}

// 코드 -> 메모 (메모에 반영): 슬롯을 블록 내용으로. 끝 줄바꿈 하나를 붙인다 — 비교는 blockValue라 같게 나온다
export function adoptContent(slot: Slot): string {
  if (!slot.column && slot.region.close === slot.region.open + 1) {
    return "";
  }
  return `${slot.text}\n`;
}

/**
 * 본문의 블록 내용을 content로 바꾼 범위와 글자. 펜스 들여쓰기를 줄마다 다시 붙인다(빈 줄 제외).
 * 원문 줄바꿈이 `\r\n`이면 그대로 맞춘다. 안 닫힌 블록은 본문 끝까지가 내용이라 거부한다 — 뒤에 쓴 글이 블록으로 먹힌다.
 */
export function blockEdit(block: CodeBlock, content: string, eol: string): { start: number; end: number; text: string } | null {
  if (!block.closed) {
    return null;
  }
  const pad = " ".repeat(block.indent ?? 0);
  const text = content === "" ? "" : blockValue(content).split("\n").map((line) => (line === "" ? "" : `${pad}${line}`)).join(eol) + eol;
  return { start: block.start, end: block.end, text };
}

function countMarkers(lines: readonly string[], markerPrefix: string): number {
  return lines.reduce((n, line) => n + markersIn(line, markerPrefix).length, 0);
}

// `\n`으로 이은 글자의 offset -> 파일 줄·칸 (첫 줄 = base)
function posIn(base: number, text: string, offset: number): Pos {
  const before = text.slice(0, offset);
  const nl = before.lastIndexOf("\n");
  return { line: base + before.split("\n").length - 1, character: offset - (nl + 1) };
}
