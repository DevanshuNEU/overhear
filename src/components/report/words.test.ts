// Every word on screen comes from src/report/labels.ts. This parses the screen's source files and fails on words
// typed anywhere else: text between JSX tags, a text attribute, a string a JSX expression renders (such as
// {x ? "Some words" : null}), and a sentence in any string of a .ts or .tsx file. Class names, ids and code values
// pass. A missing word is added to labels.ts, not to a component.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const dirs = [__dirname, path.resolve(__dirname, "../../app/reports")];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "title", "alt", "placeholder", "label"]);

// Tailwind utilities that are a bare word. Every other token of a class list has a dash, a colon, a bracket or a slash.
const BARE_UTILITIES = new Set([
  "absolute", "block", "border", "contents", "fixed", "flex", "grid", "group", "hidden", "inline", "invisible", "italic", "peer", "relative",
  "rounded", "shadow", "shrink", "static", "sticky", "table", "truncate", "underline", "uppercase", "visible", "grow", "container",
]);

const hasWord = (text: string) => /[A-Za-z]{2,}/.test(text);

/** A string that reads as a sentence or a phrase: two or more words, and not a list of class names. */
function isProse(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const words = tokens.filter((t) => /^[A-Za-z][A-Za-z']*[.,;:!?]?$/.test(t) && !BARE_UTILITIES.has(t));
  return words.length >= 2;
}

/** The static text of a string or template literal; a placeholder counts as a space. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
  return null;
}

/** The strings a JSX child expression puts on screen: the value itself, either side of a condition, the right of && or ??. */
function renderedStrings(node: ts.Expression): ts.Node[] {
  if (ts.isParenthesizedExpression(node)) return renderedStrings(node.expression);
  if (ts.isConditionalExpression(node)) return [...renderedStrings(node.whenTrue), ...renderedStrings(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return renderedStrings(node.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
      return [...renderedStrings(node.left), ...renderedStrings(node.right)];
    }
    return [];
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((e) => renderedStrings(e));
  return literalText(node) === null ? [] : [node];
}

const inClassName = (node: ts.Node) => {
  for (let n: ts.Node | undefined = node; n; n = n.parent) if (ts.isJsxAttribute(n)) return n.name.getText() === "className";
  return false;
};

/** A type, an import or export path, or a directive such as "use client": code, not words. */
const isTypeOrImport = (node: ts.Node) =>
  ts.isExpressionStatement(node.parent) ||
  ts.isLiteralTypeNode(node.parent) || ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isExternalModuleReference(node.parent);

/** Every typed word the file holds outside labels.ts. */
export function strayWords(file: string, code: string): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (hasWord(node.text)) found.push(node.text.trim());
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText()) && node.initializer) {
      const init = node.initializer;
      const strings = ts.isJsxExpression(init) ? (init.expression ? renderedStrings(init.expression) : []) : [init];
      for (const s of strings) if (hasWord(literalText(s) ?? "")) found.push(literalText(s)!.trim());
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const s of renderedStrings(node.expression)) if (hasWord(literalText(s) ?? "")) found.push(literalText(s)!.trim());
    } else {
      const text = literalText(node);
      if (text !== null && !isTypeOrImport(node) && !inClassName(node) && isProse(text)) found.push(text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(found)];
}

describe("words live in labels.ts", () => {
  const files = dirs.filter((d) => fs.existsSync(d)).flatMap(sourceFiles);

  it("finds the screen's component files and its .ts helpers", () => {
    expect(files.filter((f) => f.endsWith(".tsx")).length).toBeGreaterThan(3);
    expect(files.map((f) => path.basename(f))).toEqual(expect.arrayContaining(["answer.ts", "describe.ts", "stepsOf.ts"]));
  });

  it("catches words in each place they could hide, and lets class names, ids and code values through", () => {
    const stray = (code: string, name = "x.tsx") => strayWords(name, code);
    expect(stray(`const a = <p>Some words</p>;`)).toEqual(["Some words"]);
    expect(stray(`const a = <p>{x ? "Some words" : null}</p>;`)).toEqual(["Some words"]);
    expect(stray(`const a = <p>{x && "Copied"}</p>;`)).toEqual(["Copied"]);
    expect(stray(`const a = <p>{count} broken</p>;`)).toEqual(["broken"]);
    expect(stray(`const a = <a aria-label="Open it" />;`)).toEqual(["Open it"]);
    expect(stray(`const a = <a title={x ? "Open it" : "Close"} />;`)).toEqual(["Open it", "Close"]);
    expect(stray(`export const line = (n: number) => \`\${n} rules were broken\`;`, "x.ts")).toEqual(["rules were broken"]);
    expect(stray(`const s = "The record shows nothing.";`, "x.ts")).toEqual(["The record shows nothing."]);
    // Allowed: class lists, ids, code values, imports, and a code value compared in an expression.
    expect(
      stray(`"use client";
        import { a } from "@/report/labels";
        type K = "violated" | "passed";
        const c = "flex items-center gap-3 text-report-ink";
        const g = "group relative";
        const id = \`item-\${seq}\`;
        const k = r.kind === "unverified_result";
        const a = <div className={x ? "bg-report-critical-mark" : "rounded px-2"} data-mark="dot">{row.kind === "speech" ? <b /> : null}</div>;`),
    ).toEqual([]);
  });

  for (const file of files) {
    it(`${path.relative(process.cwd(), file)} types no words outside labels.ts`, () => {
      expect(strayWords(file, fs.readFileSync(file, "utf8"))).toEqual([]);
    });
  }
});
