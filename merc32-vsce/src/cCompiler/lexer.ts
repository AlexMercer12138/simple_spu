import { CFrontendError, SourceLocation, sourceLocation } from './source';

export type TokenKind = 'identifier' | 'keyword' | 'number' | 'string' | 'char' | 'symbol' | 'eof';
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value?: number;
  readonly line: number;
  readonly column: number;
  readonly location: SourceLocation;
}

const keywords = new Set(['void','char','short','int','long','unsigned','signed','float','double','const','volatile','restrict','typedef','struct','union','enum','static','extern','auto','register','sizeof','_Alignof','return','if','else','while','for','do','switch','case','default','break','continue','goto']);
const operators = ['>>=','<<=','...','->','++','--','==','!=','<=','>=','&&','||','<<','>>','+=','-=','*=','/=','%=','&=','|=','^='];

export function tokenizeC(
  source: string,
  sourceMap: readonly { readonly file: string; readonly line: number }[] = [],
): Token[] {
  const out: Token[] = []; let i = 0, line = 1, column = 1;
  const advance = (n = 1) => { while (n-- > 0) { const c = source[i++]; if (c === '\n') { line++; column = 1; } else column++; } };
  const location = (l: number, c: number): SourceLocation => {
    const mapped = sourceMap[l - 1];
    return sourceLocation(mapped?.file ?? '', mapped?.line ?? l, c);
  };
  const token = (kind: TokenKind, text: string, l: number, c: number, value?: number): Token => ({
    kind, text, line: l, column: c, location: location(l, c), ...(value === undefined ? {} : { value }),
  });
  while (i < source.length) {
    if (/\s/.test(source[i])) { advance(); continue; }
    if (source[i] === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') advance(); continue; }
    if (source[i] === '/' && source[i + 1] === '*') { advance(2); while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance(); if (i < source.length) advance(2); continue; }
    const l = line, c = column, start = i, ch = source[i];
    if (/[A-Za-z_]/.test(ch)) { advance(); while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) advance(); const text = source.slice(start, i); out.push(token(keywords.has(text) ? 'keyword' : 'identifier', text, l, c)); continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(source[i + 1] || ''))) {
      if (ch === '0' && /[xX]/.test(source[i + 1] || '')) {
        advance(2);
        while (i < source.length && /[0-9A-Fa-f]/.test(source[i])) advance();
      } else {
        advance(); while (i < source.length && /[0-9_.]/.test(source[i])) advance();
      }
      if (i < source.length && /[eEpP]/.test(source[i])) { advance(); if (source[i] === '+' || source[i] === '-') advance(); while (i < source.length && /\d/.test(source[i])) advance(); }
      while (i < source.length && /[A-Za-z]/.test(source[i])) advance();
      const text = source.slice(start, i); const value = Number(text); out.push(token('number', text, l, c, Number.isNaN(value) ? undefined : value)); continue;
    }
    if (ch === '"' || ch === "'") { const quote = ch; advance(); while (i < source.length) { if (source[i] === '\\') advance(2); else if (source[i] === quote) { advance(); break; } else advance(); } const text = source.slice(start, i); out.push(token(quote === '"' ? 'string' : 'char', text, l, c)); continue; }
    const op = operators.find(x => source.startsWith(x, i)); if (op) { advance(op.length); out.push(token('symbol', op, l, c)); continue; }
    if ('+-*/%&|^~!=<>?:;,.(){}[]'.includes(ch)) { advance(); out.push(token('symbol', ch, l, c)); continue; }
    throw new CFrontendError(`unexpected character '${ch}'`, location(l, c));
  }
  out.push(token('eof', '', line, column)); return out;
}
