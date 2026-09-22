// 메모 입력창의 `#` 자동완성 팝업 (R8 태그). 후보 = 다른 메모의 태그(호스트) + 지금 본문의 태그

import { tagSpans, tagsIn } from "../src/core/tag";

const MAX_ITEMS = 20;
// 커서 앞이 `#` + 태그 문자로 끝나는지. 태그로 인정되는지는 tagSpans로 다시 확인한다
const QUERY = /#([\p{L}\p{N}_\-/]*)$/u;

// 캐럿 좌표를 재려고 textarea를 흉내 내는 div에 복사할 스타일
const MIRRORED = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "tabSize",
] as const;

interface Query {
  // 태그 글자가 시작하는 위치 (`#` 바로 뒤)
  start: number;
  text: string;
}

export class TagComplete {
  private others = new Map<string, number>();
  private items: string[] = [];
  private selected = 0;
  // Esc로 닫은 토큰의 시작. 같은 토큰을 계속 치는 동안 다시 열지 않는다
  private dismissedAt = -1;

  constructor(
    private readonly input: HTMLTextAreaElement,
    private readonly popup: HTMLUListElement,
  ) {
    input.addEventListener("keydown", (event) => this.onKeyDown(event));
    input.addEventListener("click", () => this.update());
    input.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        this.update();
      }
    });
    input.addEventListener("blur", () => this.close());
    input.addEventListener("scroll", () => this.close());
    // mousedown에서 막아야 textarea가 blur되지 않는다
    popup.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const li = (event.target as Element).closest("li");
      if (li?.dataset.index !== undefined) {
        this.accept(Number(li.dataset.index));
      }
    });
  }

  setOthers(counts: Array<[string, number]>): void {
    this.others = new Map(counts);
    if (!this.popup.hidden) {
      this.update();
    }
  }

  // 입력마다 부른다
  update(): void {
    const query = this.query();
    if (query === null || query.start === this.dismissedAt) {
      this.close();
      return;
    }
    this.dismissedAt = -1;
    this.items = this.candidates(query);
    if (this.items.length === 0) {
      this.close();
      return;
    }
    this.selected = 0;
    this.render();
    this.place(query.start - 1);
  }

  private query(): Query | null {
    const { selectionStart, selectionEnd, value } = this.input;
    if (selectionStart !== selectionEnd) {
      return null;
    }
    const before = value.slice(0, selectionStart);
    const match = QUERY.exec(before);
    if (match === null) {
      return null;
    }
    const start = selectionStart - match[1].length;
    // 글자 하나를 붙여 보면 태그로 인정되는 자리인지 안다 (앞 경계, 코드 블록·인라인 코드). 규칙을 여기서 따로 두지 않는다
    const isTag = tagSpans(`${before}a`).some((span) => span.start === start - 1);
    return isTag ? { start, text: match[1] } : null;
  }

  private candidates(query: Query): string[] {
    const counts = new Map(this.others);
    // 치고 있는 토큰 자신은 빼고 지금 본문의 태그를 더한다
    const value = this.input.value;
    const rest = `${value.slice(0, query.start - 1)}${value.slice(query.start + query.text.length)}`;
    for (const tag of tagsIn(rest)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const lower = query.text.toLowerCase();
    return [...counts]
      .filter(([tag]) => tag !== query.text && tag.toLowerCase().startsWith(lower))
      .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
      .slice(0, MAX_ITEMS)
      .map(([tag]) => tag);
  }

  private onKeyDown(event: KeyboardEvent): void {
    // 한글 조합 중의 Enter는 조합 확정이다. 가로채면 글자가 깨진다
    if (this.popup.hidden || event.isComposing || event.keyCode === 229) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        this.move(1);
        break;
      case "ArrowUp":
        this.move(-1);
        break;
      case "Enter":
      case "Tab":
        this.accept(this.selected);
        break;
      case "Escape":
        this.dismissedAt = this.query()?.start ?? -1;
        this.close();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private move(step: number): void {
    this.selected = (this.selected + step + this.items.length) % this.items.length;
    this.render();
  }

  private accept(index: number): void {
    const query = this.query();
    const tag = this.items[index];
    if (query === null || tag === undefined) {
      return;
    }
    const end = query.start + query.text.length;
    const next = this.input.value[end];
    const suffix = next === undefined || !/\s/.test(next) ? " " : "";
    this.input.setSelectionRange(query.start, end);
    // execCommand는 폐기 예정이지만 textarea 자체 되돌리기 기록을 남기고 input 이벤트를 낸다 (value 대입은 둘 다 안 된다)
    document.execCommand("insertText", false, `${tag}${suffix}`);
    this.close();
  }

  private close(): void {
    this.popup.hidden = true;
  }

  private render(): void {
    this.popup.replaceChildren(
      ...this.items.map((tag, i) => {
        const li = document.createElement("li");
        li.dataset.index = String(i);
        li.role = "option";
        li.textContent = `#${tag}`;
        li.className = i === this.selected ? "selected" : "";
        return li;
      }),
    );
    this.popup.hidden = false;
    this.popup.children[this.selected]?.scrollIntoView({ block: "nearest" });
  }

  // `#` 글자 바로 아래에 띄운다
  private place(hashAt: number): void {
    const caret = caretOffset(this.input, hashAt);
    const box = this.input.getBoundingClientRect();
    const top = box.top + caret.top - this.input.scrollTop + caret.height;
    const left = box.left + caret.left - this.input.scrollLeft;
    // 아래 공간이 모자라면 위로
    const height = this.popup.offsetHeight;
    this.popup.style.top = `${top + height > window.innerHeight ? top - caret.height - height : top}px`;
    this.popup.style.left = `${Math.min(left, window.innerWidth - this.popup.offsetWidth - 4)}px`;
  }
}

// textarea 안에서 pos 글자의 좌표. 같은 스타일의 div에 앞 텍스트를 넣고 표식 span의 위치를 잰다
function caretOffset(input: HTMLTextAreaElement, pos: number): { top: number; left: number; height: number } {
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const key of MIRRORED) {
    mirror.style[key] = style[key];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = input.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(pos) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const result = { top: marker.offsetTop, left: marker.offsetLeft, height: parseFloat(style.lineHeight) || marker.offsetHeight };
  mirror.remove();
  return result;
}
