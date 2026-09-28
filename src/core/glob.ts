// 제외 glob (설정 `anchorNotes.exclude`). 다시 찾기(findFiles)와 저장 시 동기화(sourcePath)가 같은 규칙을 쓰려고 순수 함수로 둔다.
// 지원: `**`(0개 이상의 경로 조각), `*`, `?`, `{a,b}`(중첩 가능). 경로는 워크스페이스 상대경로, 구분자 `/`. VSCode처럼 `*.log`는 루트에서만 맞는다

// `{a,b}`를 펼친다. findFiles가 중첩 괄호를 받는지 보장이 없어 평평한 목록으로 넘긴다
export function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  if (open === -1) {
    return [glob];
  }
  let depth = 0;
  const parts: string[] = [];
  let from = open + 1;
  for (let i = open; i < glob.length; i++) {
    const c = glob[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        parts.push(glob.slice(from, i));
        const head = glob.slice(0, open);
        const tail = glob.slice(i + 1);
        return parts.flatMap((part) => expandBraces(head + part + tail));
      }
    } else if (c === "," && depth === 1) {
      parts.push(glob.slice(from, i));
      from = i + 1;
    }
  }
  return [glob]; // 닫히지 않은 괄호는 글자 그대로
}

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const atStart = i === 0 || glob[i - 1] === "/";
      i++;
      if (atStart && glob[i + 1] === "/") {
        out += "(?:.*/)?"; // `**/` = 0개 이상의 디렉토리
        i++;
      } else {
        out += ".*";
      }
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // `dir/**`는 `dir` 자체도 맞게
  return new RegExp(`^${out.replace(/\/\.\*$/, "(?:/.*)?")}$`);
}

// 상대경로 -> 제외 여부
export function excludeMatcher(globs: readonly string[]): (path: string) => boolean {
  const patterns = globs.flatMap(expandBraces).map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
}
