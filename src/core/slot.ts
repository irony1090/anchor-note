import { createHash } from "node:crypto";

// 범위 안 슬롯 찾기 (R11 C5 슬롯 문맥). region = 범위 사이 줄들을 `\n`으로 이은 글자 (끝 줄바꿈 없음)

// 열 단위 슬롯의 앞뒤 문맥. "" = 범위 맨 앞/맨 끝에 붙음
export interface SlotContext {
  prefix: string;
  suffix: string;
}

export interface Span {
  start: number;
  end: number;
}

export type Located = Span | "missing" | "ambiguous";

/**
 * 문맥으로 슬롯을 찾는다. 슬롯 시작 = prefix가 나온 자리 바로 뒤(prefix ""이면 0),
 * 슬롯 끝 = 그 뒤 처음 나오는 suffix 자리(suffix ""이면 범위 끝). 답이 딱 하나일 때만 돌려준다 — 추측하지 않는다.
 */
export function locateSlot(region: string, ctx: SlotContext): Located {
  const starts: number[] = [];
  if (ctx.prefix === "") {
    starts.push(0);
  } else {
    for (let i = region.indexOf(ctx.prefix); i !== -1; i = region.indexOf(ctx.prefix, i + 1)) {
      starts.push(i + ctx.prefix.length);
    }
  }

  const found: Span[] = [];
  for (const start of starts) {
    const end = ctx.suffix === "" ? region.length : region.indexOf(ctx.suffix, start);
    if (end !== -1 && !found.some((span) => span.start === start && span.end === end)) {
      found.push({ start, end });
    }
  }
  if (found.length === 0) {
    return "missing";
  }
  return found.length === 1 ? found[0] : "ambiguous";
}

/**
 * [start, end)를 딱 한 곳으로 가리키는 가장 짧은 문맥. 범위 끝까지 늘려도 안 되면 null.
 * prefix를 먼저 늘리고, 각 길이에서 suffix를 가장 짧은 것부터 시험한다. 짧을수록 코드가 바뀌어도 덜 깨진다.
 */
export function pickContext(region: string, start: number, end: number): SlotContext | null {
  for (let p = start === 0 ? 0 : 1; p <= start; p++) {
    const prefix = region.slice(start - p, start);
    for (let s = end === region.length ? 0 : 1; s <= region.length - end; s++) {
      const ctx = { prefix, suffix: region.slice(end, end + s) };
      const at = locateSlot(region, ctx);
      if (typeof at !== "string" && at.start === start && at.end === end) {
        return ctx;
      }
    }
  }
  return null;
}

export type Replaced = { region: string; span: Span } | "missing" | "ambiguous" | "unsafe";

// 슬롯을 value로 바꾼 범위. 바꾼 뒤에도 같은 문맥으로 새 슬롯이 딱 한 곳 찾혀야 한다 — value에 suffix·prefix가 들어 있으면 다음 찾기가 어긋나므로 unsafe
export function replaceSlot(region: string, ctx: SlotContext, value: string): Replaced {
  const at = locateSlot(region, ctx);
  if (typeof at === "string") {
    return at;
  }
  const next = `${region.slice(0, at.start)}${value}${region.slice(at.end)}`;
  const span = { start: at.start, end: at.start + value.length };
  const again = locateSlot(next, ctx);
  if (typeof again === "string" || again.start !== span.start || again.end !== span.end) {
    return "unsafe";
  }
  return { region: next, span };
}

// 줄 단위: 범위 줄에서 여는 마커의 들여쓰기를 뗀 글자 = 메모 블록과 비교할 내용. 들여쓰기가 모자란 줄은 있는 만큼만 뗀다
export function dedentLines(lines: readonly string[], indent: string): string {
  return lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())).join("\n");
}

// 줄 단위: 메모 블록 내용(끝 `\n` 포함 가능)을 여는 마커 들여쓰기로 맞춘 줄들. 빈 줄에는 공백을 붙이지 않는다
export function indentLines(content: string, indent: string): string[] {
  if (content === "") {
    return [];
  }
  return blockValue(content).split("\n").map((line) => (line === "" ? "" : `${indent}${line}`));
}

// 블록 내용 -> 슬롯에 들어갈 글자. 줄 단위 비교·열 단위 값 모두 끝 줄바꿈 하나를 뗀 것으로 맞춘다
export function blockValue(content: string): string {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

// 비교용 해시 (D27 hash). sha1 앞 8자리
export function slotHash(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8);
}
