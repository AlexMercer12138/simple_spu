import { Token } from './lexer';
import { CFrontendError } from './source';
import { arrayType, builtinType, CType, functionType, pointerType, structType, unionType, typedefType } from './types';
import { CompoundStatement, Declaration, Declarator, Expression, Statement, TranslationUnit } from './declarations';

export function parseTranslationUnit(tokens: Token[]): TranslationUnit { return new Parser(tokens).parse(); }

class Parser {
  private i = 0; private typedefs = new Map<string, CType>();
  constructor(private readonly tokens: Token[]) {}
  private peek(n=0) { return this.tokens[this.i+n]; }
  private take(text?: string) { const t = this.peek(); if (text && t.text !== text) throw new CFrontendError(`expected '${text}'`, t.location); this.i++; return t; }
  private is(text: string) { return this.peek().text === text; }
  parse(): TranslationUnit { const declarations: Declaration[] = []; while (this.peek().kind !== 'eof') declarations.push(...this.parseDeclaration()); return { kind: 'translation-unit', declarations }; }
  private parseDeclaration(): Declaration[] {
    const first = this.peek(); const isTypedef = this.is('typedef'); if (isTypedef) this.take();
    const base = this.parseBaseType();
    if (this.is(';')) { this.take(); return [{ kind: base.kind === 'struct' ? 'struct-declaration' : 'declaration', type: base, declarators: [], location: first.location }]; }
    const result: Declaration[] = []; const ds: Declarator[] = [];
    do {
      const declarator = this.parseDeclarator(base);
      if (!isTypedef && declarator.type.kind === 'function' && this.is('{')) {
        ds.push({ ...declarator, body: this.parseCompoundStatement() });
        return [{ kind: 'declaration', type: base, declarators: ds, location: first.location }];
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
    return { name: node.name, type: this.applyDeclarator(base, node), parameters: node.functionParameters };
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
        const params: FunctionParameter[] = [];
        let variadic = false;
        if (this.is('void') && this.peek(1).text === ')') this.take();
        while (!this.is(')')) {
          if (this.is('...')) { variadic = true; this.take(); break; }
          const parameterType = this.parseBaseType();
          const parameter = this.parseDeclaratorNode();
          let parameterCType = this.applyDeclarator(parameterType, parameter);
          if (parameterCType.kind === 'array') parameterCType = pointerType(parameterCType.element);
          params.push({ name: parameter.name, type: parameterCType, location: this.peek(-1).location });
          if (!this.is(',')) break;
          this.take();
        }
        this.take(')');
        suffixes.push({ kind: 'function', parameters: params, variadic });
        continue;
      }
      break;
    }
    const functionSuffix = suffixes.find((suffix): suffix is FunctionSuffix => suffix.kind === 'function');
    return { name, pointers, inner, suffixes, functionParameters: functionSuffix?.parameters };
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
      : functionType(type, suffix.parameters.map(parameter => parameter.type), suffix.variadic);
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
    return { kind: 'compound', statements, location: start.location };
  }

  private parseStatement(): Statement {
    if (this.is('{')) return this.parseCompoundStatement();
    if (this.is(';')) {
      const start = this.take();
      return { kind:'empty', location: start.location };
    }
    if (this.peek().kind === 'identifier' && this.peek(1).text === ':') {
      const start = this.take(); this.take(':');
      return { kind: 'label', label: start.text, statement: this.parseStatement(), location: start.location };
    }
    if (this.is('if')) {
      const start = this.take(); this.take('('); const test = this.parseExpression(); this.take(')');
      const thenBranch = this.parseStatement();
      const elseBranch = this.is('else') ? (this.take(), this.parseStatement()) : undefined;
      return { kind: 'if', test, thenBranch, elseBranch, location: start.location };
    }
    if (this.is('while')) {
      const start = this.take(); this.take('('); const test = this.parseExpression(); this.take(')');
      return { kind: 'while', test, body: this.parseStatement(), location: start.location };
    }
    if (this.is('do')) {
      const start = this.take();
      const body = this.parseStatement();
      this.take('while'); this.take('('); const test = this.parseExpression(); this.take(')'); this.take(';');
      return { kind: 'do-while', body, test, location: start.location };
    }
    if (this.is('switch')) {
      const start = this.take(); this.take('('); const test = this.parseExpression(); this.take(')');
      return { kind: 'switch', test, body: this.parseStatement(), location: start.location };
    }
    if (this.is('case')) {
      const start = this.take(); const value = this.parseExpression(); this.take(':');
      return { kind: 'case', value, statement: this.parseStatement(), location: start.location };
    }
    if (this.is('default')) {
      const start = this.take(); this.take(':');
      return { kind: 'case', statement: this.parseStatement(), location: start.location };
    }
    if (this.is('for')) {
      const start = this.take(); this.take('(');
      let init: Statement | Expression | undefined;
      if (!this.is(';')) init = this.startsDeclaration() ? this.parseLocalDeclaration() : this.parseExpression();
      if (this.is(';')) this.take();
      const test = this.is(';') ? undefined : this.parseExpression(); this.take(';');
      const step = this.is(')') ? undefined : this.parseExpression(); this.take(')');
      return { kind: 'for', init, test, step, body: this.parseStatement(), location: start.location };
    }
    if (this.is('break')) { const start = this.take(); this.take(';'); return { kind:'break', location: start.location }; }
    if (this.is('continue')) { const start = this.take(); this.take(';'); return { kind:'continue', location: start.location }; }
    if (this.is('goto')) {
      const start = this.take(); const label = this.peek();
      if (label.kind !== 'identifier') throw new CFrontendError('expected label identifier', label.location);
      this.take(); this.take(';');
      return { kind:'goto', label:label.text, location: start.location };
    }
    if (this.is('return')) {
      const start = this.take();
      const expression = this.is(';') ? undefined : this.parseExpression();
      this.take(';');
      return { kind: 'return', expression, location: start.location };
    }
    if (this.startsDeclaration()) return this.parseLocalDeclaration();
    const expression = this.parseExpression();
    this.take(';');
    return { kind: 'expression', expression, location: expression.location };
  }

  private startsDeclaration(): boolean {
    return ['const','volatile','unsigned','signed','short','long','int','char','void','float','double','struct','union'].includes(this.peek().text)
      || this.peek().kind === 'identifier' && this.typedefs.has(this.peek().text);
  }

  private parseLocalDeclaration(): Statement {
    const start = this.peek();
    const type = this.parseBaseType();
    const declarator = this.parseDeclarator(type);
    if (!declarator.name) throw new CFrontendError('local declaration requires a name', start.location);
    const initializer = this.is('=') ? (this.take(), this.parseExpression()) : undefined;
    this.take(';');
    return { kind: 'local-declaration', name: declarator.name, type: declarator.type, initializer,
      location: start.location };
  }

  private parseExpression(): Expression {
    return this.parseAssignmentExpression();
  }

  private parseAssignmentExpression(): Expression {
    const left = this.parseBinaryExpression(0);
    if (!this.is('=')) return left;
    if (left.kind !== 'identifier') throw new CFrontendError('assignment target must be an identifier', this.peek().location);
    this.take();
    return { kind: 'assignment', target: left, value: this.parseAssignmentExpression(), location: left.location };
  }

  private parseBinaryExpression(minimumPrecedence: number): Expression {
    let left = this.parsePrimaryExpression();
    while (true) {
      const operator = this.peek().text;
      const precedence = binaryPrecedence(operator);
      if (precedence < minimumPrecedence) return left;
      this.take();
      const right = this.parseBinaryExpression(precedence + 1);
      left = { kind: 'binary', operator, left, right, location: left.location };
    }
  }

  private parsePrimaryExpression(): Expression {
    const token = this.peek();
    if (token.kind === 'number') {
      this.take();
      const value = token.value ?? Number.parseInt(token.text, 0);
      if (!Number.isFinite(value)) throw new CFrontendError(`invalid integer literal '${token.text}'`, token.location);
      return { kind: 'integer-literal', value, location: token.location };
    }
    if (token.kind === 'identifier') {
      this.take();
      const identifier = { kind: 'identifier' as const, name: token.text, location: token.location };
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
    throw new CFrontendError('expected expression', token.location);
  }
}

interface DeclaratorNode {
  readonly name?: string;
  readonly pointers: readonly number[];
  readonly inner?: DeclaratorNode;
  readonly suffixes: readonly DeclaratorSuffix[];
  readonly functionParameters?: readonly FunctionParameter[];
}

interface FunctionParameter { readonly name?: string; readonly type: CType; readonly location: { readonly file: string; readonly line: number; readonly column: number; }; }
interface FunctionSuffix { readonly kind: 'function'; readonly parameters: readonly FunctionParameter[]; readonly variadic: boolean; }
type DeclaratorSuffix =
  | { readonly kind: 'array'; readonly length: number | null }
  | FunctionSuffix;

function binaryPrecedence(operator: string): number {
  switch (operator) {
    case '||': return 1;
    case '&&': return 2;
    case '|': return 3;
    case '^': return 4;
    case '&': return 5;
    case '==': case '!=': return 6;
    case '<': case '<=': case '>': case '>=': return 7;
    case '<<': case '>>': return 8;
    case '+': case '-': return 9;
    case '*': case '/': case '%': return 10;
    default: return -1;
  }
}
