import { Token } from './lexer';
import { arrayType, builtinType, CType, functionType, pointerType, structType, unionType, typedefType } from './types';
import { CompoundStatement, Declaration, Declarator, Expression, Statement, TranslationUnit } from './declarations';

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
    do {
      const declarator = this.parseDeclarator(base);
      if (!isTypedef && declarator.type.kind === 'function' && this.is('{')) {
        ds.push({ ...declarator, body: this.parseCompoundStatement() });
        return [{ kind: 'declaration', type: base, declarators: ds, location: { file: '', line: first.line, column: first.column } }];
      }
      ds.push(declarator);
      this.consumeInitializer();
      if (!this.is(',')) break;
      this.take();
    } while (true);
    if (this.is(';')) this.take();
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
    const node = this.parseDeclaratorNode();
    return { name: node.name, type: this.applyDeclarator(base, node) };
  }

  private parseDeclaratorNode(): DeclaratorNode {
    const pointers: number[] = [];
    while (this.is('*')) {
      this.take();
      if (this.is('const') || this.is('volatile')) this.take();
      pointers.push(1);
    }
    let name: string | undefined;
    let inner: DeclaratorNode | undefined;
    if (this.is('(')) {
      this.take();
      inner = this.parseDeclaratorNode();
      this.take(')');
    } else if (this.peek().kind === 'identifier') {
      name = this.take().text;
    }
    const suffixes: DeclaratorSuffix[] = [];
    while (true) {
      if (this.is('[')) {
        this.take();
        let length: number | null = null;
        if (!this.is(']')) {
          const t = this.take();
          const parsed = t.value === undefined ? Number(t.text) : t.value;
          length = Number.isFinite(parsed) ? parsed : null;
        }
        this.take(']');
        suffixes.push({ kind: 'array', length });
        continue;
      }
      if (this.is('(')) {
        this.take();
        const params: CType[] = [];
        let variadic = false;
        if (this.is('void') && this.peek(1).text === ')') this.take();
        while (!this.is(')')) {
          if (this.is('...')) { variadic = true; this.take(); break; }
          const parameterType = this.parseBaseType();
          const parameter = this.parseDeclaratorNode();
          let parameterCType = this.applyDeclarator(parameterType, parameter);
          if (parameterCType.kind === 'array') parameterCType = pointerType(parameterCType.element);
          params.push(parameterCType);
          if (!this.is(',')) break;
          this.take();
        }
        this.take(')');
        suffixes.push({ kind: 'function', parameters: params, variadic });
        continue;
      }
      break;
    }
    return { name, pointers, inner, suffixes };
  }

  private applyDeclarator(base: CType, node: DeclaratorNode): CType {
    if (node.inner) {
      // A suffix outside parentheses binds before an inner pointer: (*f)(int)
      // is a pointer to a function, while *f(int) is a function returning a pointer.
      if (node.suffixes.length > 0 && node.inner.pointers.length > 0 && !node.inner.inner) {
        let type = base;
        for (let n = node.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.suffixes[n]);
        for (let n = node.inner.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.inner.suffixes[n]);
        for (let n = 0; n < node.inner.pointers.length; n++) type = pointerType(type);
        return type;
      }
      let type = this.applyDeclarator(base, node.inner);
      for (let n = node.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.suffixes[n]);
      return type;
    }
    let type = base;
    for (let n = 0; n < node.pointers.length; n++) type = pointerType(type);
    for (let n = node.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.suffixes[n]);
    return type;
  }

  private applySuffix(type: CType, suffix: DeclaratorSuffix): CType {
    return suffix.kind === 'array'
      ? arrayType(type, suffix.length)
      : functionType(type, suffix.parameters, suffix.variadic);
  }

  private consumeInitializer() {
    if (!this.is('=')) return;
    this.take();
    let depth = 0;
    while (this.peek().kind !== 'eof' && !(depth === 0 && (this.is(';') || this.is(',')))) {
      if (this.is('{') || this.is('(') || this.is('[')) depth++;
      if (this.is('}') || this.is(')') || this.is(']')) depth--;
      this.take();
    }
  }

  private parseCompoundStatement(): CompoundStatement {
    const start = this.take('{');
    const statements: Statement[] = [];
    while (!this.is('}') && this.peek().kind !== 'eof') statements.push(this.parseStatement());
    this.take('}');
    return { kind: 'compound', statements, location: { file: '', line: start.line, column: start.column } };
  }

  private parseStatement(): Statement {
    if (this.is('{')) return this.parseCompoundStatement();
    const start = this.take('return');
    const expression = this.is(';') ? undefined : this.parseExpression();
    this.take(';');
    return { kind: 'return', expression, location: { file: '', line: start.line, column: start.column } };
  }

  private parseExpression(): Expression {
    const token = this.peek();
    if (token.kind === 'number') {
      this.take();
      const value = token.value ?? Number.parseInt(token.text, 0);
      if (!Number.isFinite(value)) throw new Error(`invalid integer literal '${token.text}' at ${token.line}:${token.column}`);
      return { kind: 'integer-literal', value, location: { file: '', line: token.line, column: token.column } };
    }
    if (token.kind === 'identifier') {
      this.take();
      const identifier = { kind: 'identifier' as const, name: token.text, location: { file: '', line: token.line, column: token.column } };
      if (!this.is('(')) return identifier;
      this.take();
      const args: Expression[] = [];
      while (!this.is(')')) {
        args.push(this.parseExpression());
        if (!this.is(',')) break;
        this.take();
      }
      this.take(')');
      return { kind: 'call', callee: identifier, arguments: args, location: identifier.location };
    }
    if (this.is('(')) {
      this.take();
      const expression = this.parseExpression();
      this.take(')');
      return expression;
    }
    throw new Error(`expected expression at ${token.line}:${token.column}`);
  }
}

interface DeclaratorNode {
  readonly name?: string;
  readonly pointers: readonly number[];
  readonly inner?: DeclaratorNode;
  readonly suffixes: readonly DeclaratorSuffix[];
}

type DeclaratorSuffix =
  | { readonly kind: 'array'; readonly length: number | null }
  | { readonly kind: 'function'; readonly parameters: readonly CType[]; readonly variadic: boolean };
