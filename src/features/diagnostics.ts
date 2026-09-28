import * as vscode from "vscode";
import { markerText } from "../core/marker";
import { markerIssues } from "../core/marker-check";
import type { MarkerIssue } from "../core/marker-check";
import { markerPrefix } from "../markers/edit";
import { sourcePath } from "../markers/search";

// D24(마커 id)·D26(범위 닫는 마커) 안내: 입력 중엔 인레이 힌트(6-a), 저장·열기 때만 경고(6-b). 입력 중에 경고를 띄우면 id를 쓸 틈도 없이 물결 밑줄이 생긴다
export function registerMarkerChecks(): vscode.Disposable[] {
  const diagnostics = vscode.languages.createDiagnosticCollection("anchor-notes");

  const check = (doc: vscode.TextDocument) => {
    if (sourcePath(doc.uri) === null) {
      return;
    }
    diagnostics.set(doc.uri, issuesOf(doc).map(toDiagnostic));
  };

  // 문서가 바뀌면 VSCode가 힌트를 다시 요청하므로 onDidChangeInlayHints를 쏠 일이 없다
  const hints = vscode.languages.registerInlayHintsProvider(
    { scheme: "file" },
    {
      provideInlayHints(doc, range) {
        if (sourcePath(doc.uri) === null) {
          return [];
        }
        return issuesOf(doc)
          .filter((issue) => issue.kind === "bare" && range.contains(new vscode.Position(issue.line, issue.hit.end)))
          .map((issue) => {
            const used = issue.used.length === 0 ? "" : ` (used: ${issue.used.join(", ")})`;
            const hint = new vscode.InlayHint(new vscode.Position(issue.line, issue.hit.end), `#id?${used}`);
            hint.paddingLeft = true;
            hint.tooltip = `이 파일에 id 없는 ${markerText(issue.hit.label, markerPrefix())}가 이미 있습니다. 이 마커에 #id를 붙이세요`;
            return hint;
          });
      },
    },
  );

  vscode.workspace.textDocuments.forEach(check);
  return [
    diagnostics,
    hints,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidSaveTextDocument(check),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.delete(doc.uri)),
  ];
}

function issuesOf(doc: vscode.TextDocument): MarkerIssue[] {
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  return markerIssues(lines, markerPrefix());
}

const MESSAGES: Record<MarkerIssue["kind"], (marker: string) => string> = {
  bare: (m) => `id 없는 ${m}가 이 파일에 이미 있습니다. 둘째부터는 #id를 붙이세요 (앵커가 하나로 합쳐집니다)`,
  duplicate: (m) => `${m}의 id가 이 파일에서 겹칩니다 (앵커가 하나로 합쳐집니다)`,
  orphan: (m) => `닫는 마커 앞에 짝이 되는 ${m}가 없습니다 (같은 줄은 짝이 되지 않습니다)`,
  overlap: (m) => `${m} 범위 안에 다른 범위의 마커가 있습니다. 동기화하면 안쪽 마커가 지워집니다`,
};

function toDiagnostic(issue: MarkerIssue): vscode.Diagnostic {
  const marker = markerText(issue.hit.label, markerPrefix(), issue.hit.id);
  const message = MESSAGES[issue.kind](marker);
  const range = new vscode.Range(issue.line, issue.hit.start, issue.line, issue.hit.end);
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = "anchor-notes";
  return diagnostic;
}
