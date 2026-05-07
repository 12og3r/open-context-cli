import stringWidth from "string-width";

const ELLIPSIS = "…";

export function truncate(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(input) <= maxWidth) return input;
  // Reserve one column for ellipsis
  const budget = maxWidth - 1;
  if (budget <= 0) return ELLIPSIS;
  let acc = "";
  let used = 0;
  for (const ch of input) {
    const w = stringWidth(ch);
    if (used + w > budget) break;
    acc += ch;
    used += w;
  }
  return acc + ELLIPSIS;
}
