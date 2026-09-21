/**
 * 에디터 쪽 진입점 (에디터 주도 프로토타입).
 * - 단축키 `noteMap.noteHere`: 커서 줄에 마커가 있으면 그 메모를, 없으면 라벨을 받아 마커를 넣고 메모를 연다
 * - 마커 hover: 메모 본문 미리보기 + 열기/만들기 링크
 */

import * as vscode from "vscode";
import { isValidLabel } from "../shared/protocol";
import type { NoteStore } from "../notes/store";
import { insertMarker, markerSyntax, markerText } from "./insert";
import type { MarkerSyntax } from "./insert";
import { NOTE_EDITOR_VIEW_TYPE } from "./note-editor";

interface FoundMarker {
  label: string;
  start: number;
  end: number;
}

export function registerTriggers(notes: NoteStore): vscode.Disposable[] {
  const openNote = async (label: string) => {
    const dir = notes.dir;
    if (dir === null) {
      void vscode.window.showErrorMessage("워크스페이스 폴더가 열려 있지 않습니다");
      return;
    }
    const uri = vscode.Uri.joinPath(dir, `${label}.md`);
    await vscode.commands.executeCommand("vscode.openWith", uri, NOTE_EDITOR_VIEW_TYPE, {
      viewColumn: vscode.ViewColumn.Beside,
    } satisfies vscode.TextDocumentShowOptions);
  };

  const noteHere = async (uriArg?: string, lineArg?: number) => {
    const editor = vscode.window.activeTextEditor;
    const document =
      uriArg !== undefined ? await vscode.workspace.openTextDocument(vscode.Uri.parse(uriArg)) : editor?.document;
    if (document === undefined) {
      return;
    }
    const line = lineArg ?? editor?.selection.active.line ?? 0;
    const syntax = markerSyntax();
    const path = vscode.workspace.asRelativePath(document.uri, false);
    const text = document.lineAt(line).text;

    try {
      const found = pickMarker(text, syntax, uriArg === undefined ? editor?.selection.active.character : undefined);
      if (found !== undefined) {
        await ensureNote(notes, found.label, path, text);
        await openNote(found.label);
        return;
      }

      const label = await vscode.window.showInputBox({
        prompt: `${line + 1}번 줄에 붙일 메모 라벨`,
        placeHolder: "예: cache-scan",
        validateInput: (value) => validateLabel(value.trim(), syntax),
      });
      if (label === undefined || label.trim() === "") {
        return;
      }
      const trimmed = label.trim();
      const inserted = await insertMarker(document.uri, line, trimmed);
      if (inserted.bare) {
        void vscode.window.showWarningMessage(
          `주석 문법을 모르는 파일이라 마커만 넣었습니다. 직접 주석으로 감싸주세요: ${markerText(trimmed)}`,
        );
      }
      await ensureNote(notes, trimmed, path, inserted.lineText);
      await openNote(trimmed);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const hover: vscode.HoverProvider = {
    provideHover(document, position) {
      const text = document.lineAt(position.line).text;
      const found = markersIn(text, markerSyntax()).find(
        (m) => position.character >= m.start && position.character <= m.end,
      );
      if (found === undefined) {
        return undefined;
      }

      const md = new vscode.MarkdownString();
      md.isTrusted = { enabledCommands: ["noteMap.openNote", "noteMap.noteHere"] };
      const note = notes.get(found.label);
      if (note === undefined) {
        const args = encodeURIComponent(JSON.stringify([document.uri.toString(), position.line]));
        md.appendMarkdown(`메모 없음: \`${found.label}\`\n\n[메모 만들기](command:noteMap.noteHere?${args})`);
      } else {
        const args = encodeURIComponent(JSON.stringify([found.label]));
        md.appendMarkdown(`**${escapeMd(note.title)}** · [메모 열기](command:noteMap.openNote?${args})\n\n---\n\n`);
        md.appendMarkdown(note.body.trim() === "" ? "_(빈 메모)_" : note.body);
      }
      const range = new vscode.Range(position.line, found.start, position.line, found.end);
      return new vscode.Hover(md, range);
    },
  };

  return [
    vscode.commands.registerCommand("noteMap.noteHere", noteHere),
    vscode.commands.registerCommand("noteMap.openNote", openNote),
    vscode.languages.registerHoverProvider({ scheme: "file" }, hover),
  ];
}

/** 없으면 만들고, 있는데 이 파일이 앵커에 없으면 앵커를 덧붙인다 (D14 라벨 다중 앵커) */
async function ensureNote(notes: NoteStore, label: string, path: string, lineText: string): Promise<void> {
  const note = notes.get(label);
  if (note === undefined) {
    await notes.create({ label, title: label, kind: "marker", anchors: [{ path, lineText }], parentLabel: null });
    return;
  }
  if (!note.anchors.some((anchor) => anchor.path === path)) {
    await notes.update(label, { anchors: [...note.anchors, { path, lineText }] });
  }
}

/** suffix가 없으면 라벨이 공백에서 끊기므로 공백 라벨은 마커로 못 쓴다 (REF-notes 2절) */
function validateLabel(label: string, syntax: MarkerSyntax): string | undefined {
  if (!isValidLabel(label)) {
    return '라벨에 쓸 수 없는 문자가 있습니다 (/ \\ : * ? " < > |)';
  }
  if (syntax.suffix === "" && /\s/.test(label)) {
    return "공백은 쓸 수 없습니다 (마커가 공백에서 끊깁니다)";
  }
  return undefined;
}

/** 커서가 마커 위면 그것, 아니면 그 줄의 첫 마커 */
function pickMarker(text: string, syntax: MarkerSyntax, character: number | undefined): FoundMarker | undefined {
  const found = markersIn(text, syntax);
  if (character !== undefined) {
    const under = found.find((m) => character >= m.start && character <= m.end);
    if (under !== undefined) {
      return under;
    }
  }
  return found[0];
}

/** 라벨은 prefix 뒤 공백·금지문자·백틱 전까지. suffix가 있으면 suffix까지 */
function markersIn(text: string, syntax: MarkerSyntax): FoundMarker[] {
  const prefix = escapeRegExp(syntax.prefix);
  const pattern =
    syntax.suffix === ""
      ? new RegExp(`${prefix}([^\\s/\\\\:*?"<>|\`]+)`, "g")
      : new RegExp(`${prefix}(.+?)${escapeRegExp(syntax.suffix)}`, "g");
  return [...text.matchAll(pattern)].map((m) => ({
    label: m[1],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}
