import * as vscode from "vscode";
import { isValidLabel } from "../core/label";
import { BrokenNoteError, bodyOffset, parseNote, serializeMeta, serializeNote } from "./frontmatter";
import type { Anchor, NoteMeta } from "./frontmatter";

// 워크스페이스 첫 폴더 기준 (D8 마크다운 저장)
export const NOTES_DIR = ".notemap/notes";
const EXT = ".md";

export interface Note {
  label: string;
  meta: NoteMeta;
  // 디스크에 저장된 본문. 메모 에디터에서 저장 안 한 내용은 여기 없다
  body: string;
}

// 사용자에게 그대로 보여줄 수 있는 실패
export class NoteStoreError extends Error {}

// 노트 인덱스 (R2 노트 저장소). 디스크가 원본이고 이건 캐시다 — 바뀐 파일은 watcher가 reload로 다시 읽힌다
export class NoteStore {
  private readonly notes = new Map<string, Note>();

  // 다중 루트는 첫 폴더만 쓴다
  get dir(): vscode.Uri | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    return root === undefined ? null : vscode.Uri.joinPath(root, NOTES_DIR);
  }

  uriOf(label: string): vscode.Uri | null {
    const dir = this.dir;
    return dir === null ? null : vscode.Uri.joinPath(dir, `${label}${EXT}`);
  }

  // 저장소 폴더 바로 아래의 노트 파일이면 라벨. 하위 폴더나 다른 곳의 `.notemap`은 무시한다
  labelOf(uri: vscode.Uri): string | null {
    const dir = this.dir;
    if (dir === null || uri.scheme !== dir.scheme || uri.authority !== dir.authority) {
      return null;
    }
    const prefix = `${dir.path}/`;
    const name = uri.path.startsWith(prefix) ? uri.path.slice(prefix.length) : "";
    if (!name.endsWith(EXT) || name.includes("/")) {
      return null;
    }
    const label = name.slice(0, -EXT.length);
    return isValidLabel(label) ? label : null;
  }

  get(label: string): Note | undefined {
    return this.notes.get(label);
  }

  labels(): string[] {
    return [...this.notes.keys()];
  }

  async load(): Promise<void> {
    this.notes.clear();
    const dir = this.dir;
    if (dir === null) {
      return;
    }
    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return; // 폴더가 없다 = 메모가 없다
    }
    await Promise.all(
      entries
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([name]) => this.reload(vscode.Uri.joinPath(dir, name))),
    );
  }

  // 파일 하나를 다시 읽는다. 없거나 깨졌으면 인덱스에서만 뺀다 — 깨진 파일은 고치지 않는다 (D20 서브셋 frontmatter 파서)
  async reload(uri: vscode.Uri): Promise<void> {
    const label = this.labelOf(uri);
    if (label === null) {
      return;
    }
    let text: string;
    try {
      text = await readText(uri);
    } catch {
      this.notes.delete(label);
      return;
    }
    try {
      this.notes.set(label, { label, ...parseNote(text, label) });
    } catch (error) {
      if (!(error instanceof BrokenNoteError)) {
        throw error;
      }
      this.notes.delete(label);
      console.warn(`[note-map] ${label}${EXT} 건너뜀: ${error.message}`);
    }
  }

  forget(uri: vscode.Uri): void {
    const label = this.labelOf(uri);
    if (label !== null) {
      this.notes.delete(label);
    }
  }

  // 새 메모. 제목은 라벨과 같게 만든다
  async create(label: string, anchor: Anchor | null): Promise<Note> {
    if (!isValidLabel(label)) {
      throw new NoteStoreError(`라벨로 쓸 수 없습니다: "${label}"`);
    }
    const dir = this.requireDir();
    const uri = vscode.Uri.joinPath(dir, `${label}${EXT}`);
    // 깨진 노트는 인덱스에 없으니 디스크로도 확인한다
    if (this.notes.has(label) || (await exists(uri))) {
      throw new NoteStoreError(`이미 노트 파일이 있습니다: ${label}${EXT}`);
    }

    const now = new Date().toISOString();
    const note: Note = {
      label,
      meta: { kind: "marker", title: label, anchors: anchor === null ? [] : [anchor], created: now, updated: now, extra: [] },
      body: "",
    };
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, encode(serializeNote(label, note)));
    this.notes.set(label, note);
    return note;
  }

  // 이 경로 앵커가 없을 때만 덧붙인다. 앵커 단위 = (라벨, 경로) 쌍 하나 (D14 라벨 다중 앵커)
  async addAnchor(label: string, anchor: Anchor): Promise<void> {
    const note = this.require(label);
    if (!note.meta.anchors.some((known) => known.path === anchor.path)) {
      await this.writeMeta(label, { ...note.meta, anchors: [...note.meta.anchors, anchor] });
    }
  }

  async setAnchors(label: string, anchors: Anchor[]): Promise<void> {
    const note = this.require(label);
    await this.writeMeta(label, { ...note.meta, anchors });
  }

  /**
   * 노트 파일에 frontmatter만 다시 쓴다. 노트 파일 쓰기 통로는 이것 하나다 (새 메모 생성 제외).
   * 열린 문서면 frontmatter 범위만 WorkspaceEdit로 바꾸고 본문은 건드리지 않는다 — 파일 전체를 다시 쓰면
   * 메모 에디터에서 저장 안 한 본문이 디스크 본문으로 덮인다 (프로토타입의 덮어쓰기 버그).
   * 편집 전에 dirty였으면 저장하지 않는다. 사용자가 저장 안 한 본문을 대신 확정하지 않으려는 것이다.
   */
  private async writeMeta(label: string, meta: NoteMeta): Promise<void> {
    const uri = vscode.Uri.joinPath(this.requireDir(), `${label}${EXT}`);
    const doc = vscode.workspace.textDocuments.find((open) => !open.isClosed && open.uri.toString() === uri.toString());

    if (doc !== undefined) {
      const start = bodyOffset(doc.getText());
      if (start === null) {
        throw brokenError(label);
      }
      const wasDirty = doc.isDirty;
      const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(start)), serializeMeta(label, meta, eol));
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new NoteStoreError(`노트를 고치지 못했습니다: ${label}${EXT}`);
      }
      if (!wasDirty) {
        await doc.save();
      }
    } else {
      const text = await readText(uri);
      const start = bodyOffset(text);
      if (start === null) {
        throw brokenError(label);
      }
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      await vscode.workspace.fs.writeFile(uri, encode(`${serializeMeta(label, meta, eol)}${text.slice(start)}`));
    }

    const note = this.notes.get(label);
    if (note !== undefined) {
      this.notes.set(label, { ...note, meta });
    }
  }

  private require(label: string): Note {
    const note = this.notes.get(label);
    if (note === undefined) {
      throw new NoteStoreError(`없는 메모입니다: "${label}"`);
    }
    return note;
  }

  private requireDir(): vscode.Uri {
    const dir = this.dir;
    if (dir === null) {
      throw new NoteStoreError("워크스페이스 폴더가 열려 있지 않습니다");
    }
    return dir;
  }
}

function brokenError(label: string): NoteStoreError {
  return new NoteStoreError(`${label}${EXT}의 frontmatter가 깨져 있어 고치지 않았습니다. 텍스트 에디터로 열어 확인하세요`);
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
