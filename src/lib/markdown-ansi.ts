import { marked, type Tokens } from "marked";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";

function wrap(open: string, body: string): string {
  return `${open}${body}${RESET}`;
}

function renderInline(tokens: Tokens.Generic[]): string {
  return tokens.map(renderInlineOne).join("");
}

function renderInlineOne(t: Tokens.Generic): string {
  switch (t.type) {
    case "text": return (t as Tokens.Text).text;
    case "strong": return wrap(BOLD, renderInline((t as Tokens.Strong).tokens ?? []));
    case "em": return wrap(ITALIC, renderInline((t as Tokens.Em).tokens ?? []));
    case "codespan": return wrap(DIM, (t as Tokens.Codespan).text);
    case "link": return wrap(UNDERLINE, renderInline((t as Tokens.Link).tokens ?? []));
    case "br": return "\n";
    case "del": return renderInline((t as Tokens.Del).tokens ?? []);
    default: return (t as { raw?: string }).raw ?? "";
  }
}

function renderBlock(t: Tokens.Generic): string {
  switch (t.type) {
    case "heading": {
      const h = t as Tokens.Heading;
      return wrap(BOLD, renderInline(h.tokens ?? []));
    }
    case "paragraph": {
      const p = t as Tokens.Paragraph;
      return renderInline(p.tokens ?? []);
    }
    case "code": {
      const c = t as Tokens.Code;
      const indented = c.text.split("\n").map(l => "  " + l).join("\n");
      return wrap(DIM, indented);
    }
    case "list": {
      const l = t as Tokens.List;
      const start = typeof l.start === "number" ? l.start : 1;
      return l.items.map((item, i) => {
        const marker = l.ordered ? `${start + i}. ` : "• ";
        const body = renderInline(item.tokens ?? []);
        return marker + body;
      }).join("\n");
    }
    case "blockquote": {
      const b = t as Tokens.Blockquote;
      return (b.tokens ?? []).map(renderBlock).join("\n").split("\n")
        .map(l => "│ " + l).join("\n");
    }
    case "space": return "";
    default: return (t as { raw?: string }).raw ?? "";
  }
}

export function markdownToAnsi(md: string): string {
  const tokens = marked.lexer(md);
  return tokens.map(renderBlock).filter(s => s !== "").join("\n");
}
