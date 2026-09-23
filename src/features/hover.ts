import * as vscode from "vscode";
import { markerText, markersIn } from "../core/marker";
import { markerPrefix } from "../markers/edit";
import type { NoteStore } from "../notes/store";
import { DELETE_NOTE } from "./delete";
import { NOTE_HERE, OPEN_NOTE } from "./note-here";
import { RENAME_NOTE } from "./rename";

// 마커 hover: 노트가 있으면 제목 + 본문 + [메모 열기] [이름 변경] [삭제], 없으면 [메모 만들기] (R3 단축키·hover, R7 메모 삭제)
export function registerHover(store: NoteStore): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    { scheme: "file" },
    {
      provideHover(doc, position) {
        const hit = markersIn(doc.lineAt(position.line).text, markerPrefix()).find(
          (m) => position.character >= m.start && position.character <= m.end,
        );
        if (hit === undefined) {
          return undefined;
        }

        const md = new vscode.MarkdownString();
        // 링크로 실행할 수 있는 커맨드를 이 넷으로 제한한다. 본문에 다른 command: 링크가 있어도 안 돈다
        md.isTrusted = { enabledCommands: [OPEN_NOTE, NOTE_HERE, DELETE_NOTE, RENAME_NOTE] };
        const note = store.get(hit.label);
        if (note === undefined) {
          const args = commandArgs([doc.uri.toString(), position.line, hit.start]);
          md.appendMarkdown(`메모 없음: \`${markerText(hit.label, "", hit.id)}\`\n\n[메모 만들기](command:${NOTE_HERE}?${args})`);
        } else {
          const args = commandArgs([hit.label]);
          md.appendMarkdown(
            `**${escapeMd(note.meta.title)}**${hit.id === undefined ? "" : ` \`#${hit.id}\``} · [메모 열기](command:${OPEN_NOTE}?${args}) · [이름 변경](command:${RENAME_NOTE}?${args}) · [삭제](command:${DELETE_NOTE}?${args})\n\n`,
          );
          if (note.tags.length > 0) {
            md.appendMarkdown(`${note.tags.map((tag) => `\`#${tag}\``).join(" ")}\n\n`);
          }
          md.appendMarkdown("---\n\n");
          md.appendMarkdown(note.body.trim() === "" ? "_(빈 메모)_" : note.body);
        }
        return new vscode.Hover(md, new vscode.Range(position.line, hit.start, position.line, hit.end));
      },
    },
  );
}

function commandArgs(args: unknown[]): string {
  return encodeURIComponent(JSON.stringify(args));
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
