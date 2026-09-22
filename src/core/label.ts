// 파일명 금지 문자 + 제어문자 + 공백(D22 라벨 공백 금지) + 백틱(인용된 마커와 구분)
const LABEL_FORBIDDEN = /[/\\:*?"<>|`\s\u0000-\u001f]/;

// 라벨 = 노트 파일명 (D12 라벨 전역 유일). 마침표로 끝나면 문장 끝의 마커와 헷갈려 막는다
export function isValidLabel(label: string): boolean {
  return label !== "" && !label.endsWith(".") && !LABEL_FORBIDDEN.test(label);
}

// 라벨에 들어갈 수 있는 글자로만 됐는지. 쓰다 만 라벨(빈 문자열, 끝 마침표)도 통과한다
export function isLabelChars(text: string): boolean {
  return !LABEL_FORBIDDEN.test(text);
}

// 입력값의 공백 덩어리를 `_` 하나로 (D22 라벨 공백 금지)
export function toLabel(input: string): string {
  return input.trim().replace(/\s+/g, "_");
}
