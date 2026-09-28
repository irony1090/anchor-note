import * as vscode from "vscode";
import { sameAnchor } from "../core/anchors";
import { isValidLabel } from "../core/label";
import { tagsIn } from "../core/tag";
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
  // 본문의 `#태그` (R8 태그). 목록을 따로 저장하지 않고 본문에서 계산한다
  tags: string[];
}

// 사용자에게 그대로 보여줄 수 있는 실패
export class NoteStoreError extends Error {}

// 노트 인덱스 (R2 노트 저장소). 디스크가 원본이고 이건 캐시다 — 바뀐 파일은 watcher가 reload로 다시 읽힌다
export class NoteStore {
  private readonly notes = new Map<string, Note>();
  private readonly changed = new vscode.EventEmitter<void>();
  // 노트가 생기거나 바뀌거나 사라질 때. 열린 메모 에디터의 태그 목록 갱신, R9(둘러보기 페이지)가 쓴다
  readonly onDidChange = this.changed.event;

  dispose(): void {
    this.changed.dispose();
  }

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

  // 지금 보이는 본문. 노트 문서가 열려 있으면 저장 안 한 내용까지, 아니면 디스크 본문 (R11 코드 넣기·동기화)
  liveBody(label: string): string | undefined {
    const uri = this.uriOf(label)?.toString();
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (doc !== undefined) {
      const text = doc.getText();
      const offset = bodyOffset(text);
      if (offset !== null) {
        return text.slice(offset);
      }
    }
    return this.notes.get(label)?.body;
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
      this.drop(label);
      return;
    }
    try {
      this.put({ label, ...parseNote(text, label) });
    } catch (error) {
      if (!(error instanceof BrokenNoteError)) {
        throw error;
      }
      this.drop(label);
      console.warn(`[anchor-notes] ${label}${EXT} 건너뜀: ${error.message}`);
    }
  }

  forget(uri: vscode.Uri): void {
    const label = this.labelOf(uri);
    if (label !== null) {
      this.drop(label);
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
    const note: Omit<Note, "tags"> = {
      label,
      meta: { title: label, anchors: anchor === null ? [] : [anchor], created: now, updated: now, extra: [] },
      body: "",
    };
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, encode(serializeNote(label, note)));
    this.put(note);
    return this.require(label);
  }

  /**
   * 노트 파일을 지운다 (R7 메모 삭제). 인덱스에서 먼저 빼서, 뒤따르는 마커 삭제의 저장이 R5(마커 스캔)로 이 노트를 다시 쓰지 않게 한다.
   * 열린 문서가 dirty면 저장부터 한다 — dirty 탭을 닫으면 저장 여부를 묻고, 거기서 저장을 고르면 지운 파일이 되살아난다.
   */
  async delete(label: string): Promise<void> {
    this.require(label);
    const uri = vscode.Uri.joinPath(this.requireDir(), `${label}${EXT}`);
    const doc = vscode.workspace.textDocuments.find((open) => !open.isClosed && open.uri.toString() === uri.toString());
    if (doc?.isDirty) {
      await doc.save();
    }
    this.drop(label);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: false }); // 휴지통이 없는 파일시스템
      } catch (error) {
        await this.reload(uri);
        throw new NoteStoreError(`노트 파일을 지우지 못했습니다: ${label}${EXT} (${error instanceof Error ? error.message : error})`);
      }
    }
  }

  /**
   * 라벨 이름 바꾸기. 파일 이름·frontmatter와 addEdits가 담는 편집(코드의 마커)을 **WorkspaceEdit 하나**로 적용한다 (틀리면 되돌리기가 어긋난다).
   * 따로 적용하면 되돌리기 기록이 갈라져 Ctrl+Z가 한쪽만 되돌린다 -> 노트 `b.md`에 마커 `@note:a`로 어긋나고, R7 메모 삭제가 `b`를 사라진 노트로 본다.
   * 하나로 묶으면 VSCode가 "모든 파일에서 되돌릴까요?"로 한 번에 되돌린다. 파일 이름을 WorkspaceEdit로 바꿔야 열린 탭도 VSCode가 옮기고
   * onWillRenameFiles가 떠서 R7이 바깥 삭제로 보지 않는다 (workspace.fs.rename은 둘 다 안 한다).
   */
  async rename(from: string, to: string, addEdits?: (edit: vscode.WorkspaceEdit) => Promise<void>): Promise<void> {
    const note = this.require(from);
    if (!isValidLabel(to)) {
      throw new NoteStoreError(`라벨로 쓸 수 없습니다: "${to}"`);
    }
    const dir = this.requireDir();
    const source = vscode.Uri.joinPath(dir, `${from}${EXT}`);
    const target = vscode.Uri.joinPath(dir, `${to}${EXT}`);
    if (this.notes.has(to) || (await exists(target))) {
      throw new NoteStoreError(`이미 있는 라벨입니다: ${to}`);
    }

    const doc = vscode.workspace.textDocuments.find((open) => !open.isClosed && open.uri.toString() === source.toString());
    const text = doc?.getText() ?? (await readText(source));
    const start = bodyOffset(text);
    if (start === null) {
      throw brokenError(from);
    }
    // 제목을 따로 정하지 않았으면(= 옛 라벨) 새 라벨을 따라간다
    const meta = note.meta.title === from ? { ...note.meta, title: to } : note.meta;
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(source, target, { overwrite: false });
    // 이름을 바꾼 파일의 frontmatter만 갈아 끼운다. 본문은 안 건드린다 (writeMeta와 같은 규칙)
    edit.replace(target, new vscode.Range(new vscode.Position(0, 0), positionIn(text, start)), serializeMeta(to, meta, eolOf(text)));
    await addEdits?.(edit);

    const wasDirty = doc?.isDirty ?? false;
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new NoteStoreError(`노트 이름을 바꾸지 못했습니다: ${from}${EXT}`);
    }
    this.drop(from);
    this.put({ ...note, label: to, meta });
    if (!wasDirty) {
      await (await vscode.workspace.openTextDocument(target)).save();
    }
  }

  // 제목 편집. 한 줄로 만들고, 비우면 라벨로 되돌린다
  async setTitle(label: string, title: string): Promise<void> {
    const note = this.require(label);
    const clean = title.replace(/\s+/g, " ").trim() || label;
    if (clean !== note.meta.title) {
      await this.writeMeta(label, { ...note.meta, title: clean });
    }
  }

  // 같은 앵커(core/anchors sameAnchor)가 없을 때만 덧붙인다 (D14 라벨 다중 앵커)
  async addAnchor(label: string, anchor: Anchor): Promise<void> {
    const note = this.require(label);
    if (!note.meta.anchors.some((known) => sameAnchor(known, anchor))) {
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
      this.put({ ...note, meta });
    }
  }

  // 태그 전체와 각 태그를 가진 메모 수. except 라벨은 뺀다 (메모 에디터가 저장 전 본문으로 자기 몫을 더한다)
  tagCounts(except?: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const note of this.notes.values()) {
      if (note.label !== except) {
        for (const tag of note.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
    return counts;
  }

  labelsWithTag(tag: string): string[] {
    return [...this.notes.values()].filter((note) => note.tags.includes(tag)).map((note) => note.label);
  }

  // 인덱스 쓰기는 이 둘로만 한다. 태그 계산과 변경 이벤트를 빠뜨리지 않게
  private put(note: Omit<Note, "tags">): void {
    this.notes.set(note.label, { ...note, tags: tagsIn(note.body) });
    this.changed.fire();
  }

  private drop(label: string): void {
    if (this.notes.delete(label)) {
      this.changed.fire();
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

// 문자 위치 -> 줄·칸 (문서를 열지 않은 파일용)
function positionIn(text: string, offset: number): vscode.Position {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return new vscode.Position(line, offset - (before.lastIndexOf("\n") + 1));
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
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
