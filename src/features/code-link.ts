import * as vscode from "vscode";
import { markerAnchor, sameAnchor } from "../core/anchors";
import { codeBlocks, duplicateBlockNames } from "../core/codeblock";
import type { CodeBlock } from "../core/codeblock";
import { hasComment, wrapMarker } from "../core/comment";
import { closeMarkerText, markerText } from "../core/marker";
import { regionsIn } from "../core/region";
import type { Region } from "../core/region";
import { blockValue, dedentLines, indentLines, pickContext, slotHash } from "../core/slot";
import { markerPrefix } from "../markers/edit";
import { runAnchorTask } from "../markers/sync";
import type { Anchor, CodeLink } from "../notes/frontmatter";
import type { NoteStore } from "../notes/store";
import { pickNote } from "./insert-code";
import { anchorPath, askId } from "./note-here";

export const LINK_CODE = "anchorNotes.linkCode";

// 메모 코드와 연결 (R11 C6 연결 명령). 범위 안 선택 = 열 단위, 범위 밖은 줄 일부 선택이면 감싸고 열 단위, 줄 전체면 줄 단위
export function registerCodeLink(store: NoteStore): vscode.Disposable {
  return vscode.commands.registerCommand(LINK_CODE, async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined) {
        return;
      }
      const doc = editor.document;
      const path = anchorPath(store, doc.uri);
      if (!hasComment(doc.languageId)) {
        throw new Error("주석 문법을 모르는 파일은 동기화할 수 없습니다. \"메모 코드 넣기\"로 한 번 넣으세요");
      }
      const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
      const { regions } = regionsIn(lines, markerPrefix());
      const { start, end } = editor.selection;
      const region = regions.find((r) => start.line > r.open && end.line < r.close);
      if (region !== undefined) {
        await linkColumn(store, editor, path, lines, region);
      } else {
        await linkLines(store, editor, path, lines, regions);
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  });
}

class Cancelled extends Error {}

// 열 단위: 범위의 라벨·id를 그대로 쓰고, 선택 자리를 블록 값으로 바꾼 뒤 그 자리의 앞뒤 문맥을 기억한다
async function linkColumn(store: NoteStore, editor: vscode.TextEditor, path: string, lines: string[], region: Region): Promise<void> {
  const block = await pickLinkBlock(store, region.label);
  const value = blockValue(block.content);
  const inner = lines.slice(region.open + 1, region.close).join("\n");
  const offsetOf = (pos: vscode.Position) =>
    lines.slice(region.open + 1, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.character;
  const start = offsetOf(editor.selection.start);
  const end = offsetOf(editor.selection.end);

  const next = `${inner.slice(0, start)}${value}${inner.slice(end)}`;
  const ctx = pickContext(next, start, start + value.length);
  if (ctx === null) {
    throw new Error("이 자리를 가리킬 앞뒤 문맥을 찾지 못했습니다. 범위 안에 같은 글자가 너무 많습니다");
  }
  const link: CodeLink = { ...blockKey(block), prefix: ctx.prefix, suffix: ctx.suffix, hash: slotHash(value) };
  await applyLinked(store, editor.document, region.label, path, region.id, link, (edit) =>
    edit.replace(editor.document.uri, editor.selection, value),
  );
}

/*
 * 범위 밖 선택. 줄 전체(빈 선택 포함)면 줄 단위: 선택한 줄(빈 선택이면 커서가 있는 빈 줄)을 감싸고 블록 내용으로 채운다.
 * 줄의 일부만 선택했으면 열 단위: 걸친 줄들을 내용 그대로 감싸고 선택 글자만 블록 값으로 바꾼 뒤 그 자리의 문맥을 기억한다
 * (범위 만들기 + 범위 안 연결을 한 번에. 예전에는 줄 단위로 먼저 감싸야 해서 그 줄이 메모 내용으로 덮였다).
 */
async function linkLines(store: NoteStore, editor: vscode.TextEditor, path: string, lines: string[], regions: Region[]): Promise<void> {
  const doc = editor.document;
  const { start, end, isEmpty } = editor.selection;
  const first = start.line;
  // 다음 줄 맨 앞까지 끌어 선택한 경우 그 줄은 빼고
  const last = !isEmpty && end.character === 0 && end.line > first ? end.line - 1 : end.line;
  const partial = !isEmpty && (start.character > leadOf(lines[first]) || (end.line === last && end.character < lines[last].trimEnd().length));
  if (isEmpty && lines[first].trim() !== "") {
    throw new Error("연결할 줄을 선택하거나, 빈 줄에서 실행하세요");
  }
  if (regions.some((r) => (r.open >= first && r.open <= last) || (r.close >= first && r.close <= last))) {
    throw new Error("선택 안에 다른 범위의 마커가 있습니다 (범위는 겹칠 수 없습니다)");
  }

  const label = await pickNote(store, "메모 코드와 연결 - 메모");
  if (label === undefined) {
    throw new Cancelled();
  }
  const block = await pickLinkBlock(store, label);
  const id = await askId(doc, label);
  if (id === null) {
    throw new Cancelled();
  }

  const indent = /^\s*/.exec(lines[first])?.[0] ?? "";
  const selected = lines.slice(first, last + 1);
  const value = blockValue(block.content);
  const prefix = markerPrefix();
  const open = `${indent}${wrapMarker(doc.languageId, markerText(label, prefix, id)).text}`;
  const close = `${indent}${wrapMarker(doc.languageId, closeMarkerText(label, prefix, id)).text}`;
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const range = new vscode.Range(first, 0, last, lines[last].length);

  if (partial) {
    const inner = selected.join("\n");
    const from = start.character;
    const to = Math.min(inner.length, selected.slice(0, end.line - first).reduce((n, line) => n + line.length + 1, 0) + end.character);
    const next = `${inner.slice(0, from)}${value}${inner.slice(to)}`;
    const ctx = pickContext(next, from, from + value.length);
    if (ctx === null) {
      throw new Error("이 자리를 가리킬 앞뒤 문맥을 찾지 못했습니다. 선택한 줄 안에 같은 글자가 너무 많습니다");
    }
    const text = [open, ...next.split("\n"), close].join(eol);
    const link: CodeLink = { ...blockKey(block), prefix: ctx.prefix, suffix: ctx.suffix, hash: slotHash(value) };
    await applyLinked(store, doc, label, path, id, link, (edit) => edit.replace(doc.uri, range, text));
    return;
  }

  if (selected.some((line) => line.trim() !== "") && dedentLines(selected, indent) !== value) {
    const replace = "메모 코드로 바꾸기";
    const answer = await vscode.window.showWarningMessage(`선택한 ${selected.length}줄을 메모 코드로 바꿉니다.`, { modal: true }, replace);
    if (answer !== replace) {
      throw new Cancelled();
    }
  }

  const text = [open, ...indentLines(block.content, indent), close].join(eol);
  await applyLinked(store, doc, label, path, id, { ...blockKey(block), hash: slotHash(value) }, (edit) => edit.replace(doc.uri, range, text));
}

/**
 * 연결 정보를 먼저 쓰고 코드를 고친다 (순서를 바꾸면 연결 정보가 사라진다).
 * 코드를 저장하면 저장 동기화(markers/sync)가 이 파일 앵커를 맞추는데, 앵커가 이미 있어야 link가 달린 객체를 그대로 둔다.
 * 코드 편집이 실패하면 앵커를 되돌린다. 코드 파일은 편집 전에 dirty가 아니었을 때만 저장한다.
 */
async function applyLinked(
  store: NoteStore,
  doc: vscode.TextDocument,
  label: string,
  path: string,
  id: string | undefined,
  link: CodeLink,
  build: (edit: vscode.WorkspaceEdit) => void,
): Promise<void> {
  const anchor: Anchor = { ...markerAnchor(path, id), link } as Anchor;
  const before = await runAnchorTask(async () => {
    const note = store.get(label);
    if (note === undefined) {
      throw new Error(`없는 메모입니다: "${label}"`);
    }
    const anchors = note.meta.anchors;
    const i = anchors.findIndex((known) => sameAnchor(known, anchor));
    await store.setAnchors(label, i === -1 ? [...anchors, anchor] : anchors.map((known, j) => (j === i ? anchor : known)));
    return anchors;
  });

  const wasDirty = doc.isDirty;
  const edit = new vscode.WorkspaceEdit();
  build(edit);
  if (!(await vscode.workspace.applyEdit(edit))) {
    await runAnchorTask(() => store.setAnchors(label, before));
    throw new Error("코드를 고치지 못했습니다 (읽기 전용 파일일 수 있습니다)");
  }
  if (!wasDirty) {
    await doc.save();
  }
}

// 연결할 블록. 블록이 여럿이면 이름이 있어야 한다 — 연결은 이름으로 블록을 찾는다 (vault REF-code-sync 6절)
async function pickLinkBlock(store: NoteStore, label: string): Promise<CodeBlock> {
  const blocks = codeBlocks(store.liveBody(label) ?? "");
  if (blocks.length === 0) {
    throw new Error(`"${label}" 메모에 코드 블록이 없습니다`);
  }
  if (blocks.length === 1) {
    return blocks[0];
  }
  const dup = new Set(duplicateBlockNames(blocks));
  const items = blocks.map((block) => ({
    label: block.name ?? "(이름 없음)",
    description: [block.lang, block.name === undefined ? "이름이 없어 연결 불가" : dup.has(block.name) ? "이름이 겹쳐 연결 불가" : undefined]
      .filter((part) => part !== undefined)
      .join(" · "),
    detail: block.content.split("\n").find((line) => line.trim() !== "") ?? "",
    block,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: `메모 코드와 연결 - ${label}의 코드 블록`, matchOnDetail: true });
  if (picked === undefined) {
    throw new Cancelled();
  }
  const { name } = picked.block;
  if (name === undefined) {
    throw new Error("블록이 여럿인 메모에서는 이름 있는 블록만 연결합니다. 펜스에 이름을 붙이세요 (```c 이름)");
  }
  if (dup.has(name)) {
    throw new Error(`블록 이름 "${name}"이 메모 안에서 겹칩니다. 하나만 남기세요`);
  }
  return picked.block;
}

// 줄 앞 공백 수. 선택이 여기부터면 줄 앞을 다 고른 것으로 본다
function leadOf(line: string): number {
  return line.length - line.trimStart().length;
}

function blockKey(block: CodeBlock): { block?: string } {
  return block.name === undefined ? {} : { block: block.name };
}
