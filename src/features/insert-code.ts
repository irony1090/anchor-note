import * as vscode from "vscode";
import { codeBlocks } from "../core/codeblock";
import type { CodeBlock } from "../core/codeblock";
import { markersIn } from "../core/marker";
import { markerPrefix } from "../markers/edit";
import type { NoteStore } from "../notes/store";

export const INSERT_CODE = "anchorNotes.insertCode";

// 메모 코드 넣기 (R11 C2 한 번 넣기): 메모 -> 코드 블록 -> 커서 자리에 복사. 이후 메모와 관계 없음
export function registerInsertCode(store: NoteStore): vscode.Disposable {
  return vscode.commands.registerCommand(INSERT_CODE, async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage("코드를 넣을 에디터를 먼저 여세요");
      return;
    }
    const label = await pickNote(store);
    if (label === undefined) {
      return;
    }
    const body = store.liveBody(label) ?? "";
    const text = await pickText(body, label);
    if (text === undefined) {
      return;
    }
    if (!(await confirmMarkers(text))) {
      return;
    }
    // appendText가 `$`·`}`·`\`를 이스케이프한다. 여러 줄은 VSCode가 커서 줄 들여쓰기에 맞춘다
    await editor.insertSnippet(new vscode.SnippetString().appendText(text));
  });
}

// 기존 메모만. 설명에 코드 블록 수
async function pickNote(store: NoteStore): Promise<string | undefined> {
  const items = store
    .labels()
    .sort((a, b) => a.localeCompare(b))
    .map((label) => {
      const title = store.get(label)?.meta.title ?? label;
      const count = codeBlocks(store.liveBody(label) ?? "").length;
      return {
        label,
        description: [title === label ? undefined : title, count === 0 ? "코드 블록 없음 - 본문 전체" : `코드 블록 ${count}개`]
          .filter((part) => part !== undefined)
          .join(" · "),
      };
    });
  if (items.length === 0) {
    void vscode.window.showInformationMessage("메모가 없습니다");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { title: "메모 코드 넣기 - 메모", matchOnDescription: true });
  return picked?.label;
}

// 블록이 하나면 그 블록, 여럿이면 고르기, 없으면 본문 전체. 끝 줄바꿈 하나는 뗀다 — 빈 줄에 넣으면 딱 그 줄들만 들어가게
async function pickText(body: string, label: string): Promise<string | undefined> {
  const blocks = codeBlocks(body);
  if (blocks.length === 0) {
    return trimBlankLines(body);
  }
  const block = blocks.length === 1 ? blocks[0] : await pickBlock(blocks, label);
  return block === undefined ? undefined : block.content.replace(/\n$/, "");
}

async function pickBlock(blocks: CodeBlock[], label: string): Promise<CodeBlock | undefined> {
  const items = blocks.map((block) => ({
    label: block.name ?? "(이름 없음)",
    description: block.lang,
    detail: firstLine(block.content),
    block,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: `메모 코드 넣기 - ${label}의 코드 블록`, matchOnDetail: true });
  return picked?.block;
}

// 넣을 내용에 마커가 있으면 확인. 그대로 넣으면 그 라벨 메모에 앵커가 늘어난다 (D14 라벨 다중 앵커)
async function confirmMarkers(text: string): Promise<boolean> {
  const prefix = markerPrefix();
  const count = text.split("\n").reduce((n, line) => n + markersIn(line, prefix).length, 0);
  if (count === 0) {
    return true;
  }
  const insert = "그대로 넣기";
  const answer = await vscode.window.showWarningMessage(
    `넣을 내용에 마커가 ${count}개 있습니다. 그대로 넣으면 그 메모에 앵커가 늘어납니다.`,
    { modal: true },
    insert,
  );
  return answer === insert;
}

function firstLine(content: string): string {
  const line = content.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function trimBlankLines(text: string): string {
  return text.replace(/^(\s*\n)+/, "").replace(/(\n\s*)+$/, "");
}
