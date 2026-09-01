import { Token } from './lexer';
import { arrayType, builtinType, CType, functionType, pointerType, structType, unionType, typedefType } from './types';
import { Declaration, Declarator, TranslationUnit } from './declarations';

export function parseTranslationUnit(tokens: Token[]): TranslationUnit { return new Parser(tokens).parse(); }

class Parser {
  private i = 0; private typedefs = new Map<string, CType>();
  constructor(private readonly tokens: Token[]) {}
  private peek(n=0) { return this.tokens[this.i+n]; }
  private take(text?: string) { const t = this.peek(); if (text && t.text !== text) throw new Error(`expected '${text}' at ${t.line}:${t.column}`); this.i++; return t; }
  private is(text: string) { return this.peek().text === text; }
  parse(): TranslationUnit { const declarations: Declaration[] = []; while (this.peek().kind !== 'eof') declarations.push(...this.parseDeclaration()); return { kind: 'translation-unit', declarations }; }
  private parseDeclaration(): Declaration[] {
    const first = this.peek(); const isTypedef = this.is('typedef'); if (isTypedef) this.take();
    const base = this.parseBaseType();
    if (this.is(';')) { this.take(); return [{ kind: base.kind === 'struct' ? 'struct-declaration' : 'declaration', type: base, declarators: [], location: { file:'', line:first.line, column:first.column } }]; }
    const result: Declaration[] = []; const ds: Declarator[] = [];
    do { ds.push(this.parseDeclarator(base)); if (!this.is(',')) break; this.take(); } while (true);
    this.consumeInitializerAndSemicolon();
    if (isTypedef) { ds.forEach(d => { if (d.name) this.typedefs.set(d.name, d.type); }); result.push({ kind:'typedef', type: base, declarators: ds }); }
    else result.push({ kind:'declaration', type: base, declarators: ds });
    return result;
  }
  private parseBaseType(): CType {
    const words: string[] = []; while (['const','volatile','unsigned','signed','short','long','int','char','void','float','double'].includes(this.peek().text)) words.push(this.take().text);
    if (words.length === 0 && this.peek().kind === 'identifier' && this.typedefs.has(this.peek().text)) {
      return this.typedefs.get(this.take().text)!;
    }
    if (this.is('struct') || this.is('union')) { const k = this.take().text as 'struct'|'union'; const name = this.peek().kind === 'identifier' ? this.take().text : undefined; const fields: {name:string,type:CType}[] = []; if (this.is('{')) { this.take(); while (!this.is('}') && this.peek().kind !== 'eof') { const ft = this.parseBaseType(); do { const fd = this.parseDeclarator(ft); if (fd.name) fields.push({name:fd.name,type:fd.type}); if (!this.is(',')) break; this.take(); } while (true); this.take(';'); } this.take('}'); } return k === 'struct' ? structType(fields,name) : unionType(fields,name); }
    const id = words.join(' ').replace('signed ',''); const known = this.typedefs.get(id); if (known) return known;
    const valid = ['void','char','short','int','long','long long','float','double','unsigned char','unsigned short','unsigned int','unsigned long','unsigned long long'];
    return valid.includes(id) ? builtinType(id as any) : typedefType(id || 'int');
  }
  private parseDeclarator(base: CType): Declarator {
    let type = base; while (this.is('*')) { this.take(); if (this.is('const') || this.is('volatile')) this.take(); type = pointerType(type); }
    let name: string | undefined;
    if (this.is('(')) { this.take(); const inner = this.parseDeclarator(type); this.take(')'); name = inner.name; type = inner.type; }
    else if (this.peek().kind === 'identifier') name = this.take().text;
    while (true) {
      if (this.is('[')) { this.take(); let len: number|null = null; if (!this.is(']')) { const t=this.take(); len = t.value === undefined ? Number(t.text) : t.value; } this.take(']'); type = arrayType(type, Number.isFinite(len as number) ? len : null); continue; }
      if (this.is('(')) { this.take(); const params: CType[] = []; let variadic=false; while (!this.is(')')) { if (this.is('...')) { variadic=true; this.take(); break; } const pt=this.parseBaseType(); const pd=this.parseDeclarator(pt); params.push(pd.type); if (!this.is(',')) break; this.take(); } this.take(')'); type = functionType(type, params, variadic); continue; }
      break;
    }
    return { name, type };
  }
  private consumeInitializerAndSemicolon() { if (this.is('=')) { this.take(); let depth=0; while (this.peek().kind!=='eof' && !(depth===0 && (this.is(';') || this.is(',')))) { if (this.is('{')||this.is('(')||this.is('[')) depth++; if (this.is('}')||this.is(')')||this.is(']')) depth--; this.take(); } } if (this.is(';')) this.take(); }
}
