import { Token } from './lexer';
import { CFrontendError } from './source';
import { arrayType, builtinType, CType, functionType, pointerType, qualifyType, structType, unionType, typedefType, TypeQualifiers } from './types';
import { CInitializer, CompoundStatement, Declaration, Declarator, Expression, Initializer, InitializerDesignator, Statement, TranslationUnit } from './declarations';

type MutableQualifiers = { -readonly [K in keyof TypeQualifiers]?: boolean };

export function parseTranslationUnit(tokens: Token[]): TranslationUnit { return new Parser(tokens).parse(); }

class Parser {
  private i = 0;
  private readonly typedefs = new Map<string, CType>();
  private readonly tags = new Map<string, CType>();
  constructor(private readonly tokens: Token[]) {}
  private peek(n=0) { return this.tokens[this.i+n]; }
  private take(text?: string) { const t = this.peek(); if (text && t.text !== text) throw new CFrontendError(`expected '${text}'`, t.location); this.i++; return t; }
  private is(text: string) { return this.peek().text === text; }
  parse(): TranslationUnit { const declarations: Declaration[] = []; while (this.peek().kind !== 'eof') declarations.push(...this.parseDeclaration()); return { kind: 'translation-unit', declarations }; }
  private parseDeclaration(): Declaration[] {
    const first = this.peek(); const isTypedef = this.is('typedef'); if (isTypedef) this.take();
    const base = this.parseBaseType();
    if (this.is(';')) {
      this.take();
      return [{
        kind: base.kind === 'struct' || base.kind === 'union' ? 'struct-declaration' : 'declaration',
        type: base,
        declarators: [],
        name: base.kind === 'struct' || base.kind === 'union' ? base.name : undefined,
        location: first.location,
      }];
    }
    const result: Declaration[] = []; const ds: Declarator[] = [];
    do {
      const declarator = this.parseDeclarator(base);
      if (!isTypedef && declarator.type.kind === 'function' && this.is('{')) {
        ds.push({ ...declarator, body: this.parseCompoundStatement() });
        return [{ kind: 'declaration', type: base, declarators: ds, location: first.location }];
      }
      const initializer = this.consumeInitializer();
      ds.push(initializer ? { ...declarator, initializer } : declarator);
      if (!this.is(',')) break;
      this.take();
    } while (true);
    if (this.is(';')) this.take();
    if (isTypedef) { ds.forEach(d => { if (d.name) this.typedefs.set(d.name, d.type); }); result.push({ kind:'typedef', type: base, declarators: ds }); }
    else result.push({ kind:'declaration', type: base, declarators: ds });
    return result;
  }
  private parseBaseType(): CType {
    const words: string[] = [];
    const typeQualifiers: MutableQualifiers = {};
    while (true) {
      if (isQualifier(this.peek().text)) {
        typeQualifiers[this.take().text as keyof TypeQualifiers] = true;
        continue;
      }
      if (['unsigned','signed','short','long','int','char','void','float','double'].includes(this.peek().text)) {
        words.push(this.take().text);
        continue;
      }
      break;
    }
    if (words.length === 0 && this.peek().kind === 'identifier' && this.typedefs.has(this.peek().text)) {
      return qualifyType(this.typedefs.get(this.take().text)!, typeQualifiers);
    }
    if (words.length === 0 && (this.is('struct') || this.is('union'))) {
      const kind = this.take().text as 'struct'|'union';
      const name = this.peek().kind === 'identifier' ? this.take().text : undefined;
      let fields: {name:string,type:CType}[] | undefined;
      if (this.is('{')) {
        fields = [];
        this.take();
        while (!this.is('}') && this.peek().kind !== 'eof') {
          const fieldType = this.parseBaseType();
          do {
            const field = this.parseDeclarator(fieldType);
            if (field.name) fields.push({ name: field.name, type: field.type });
            if (!this.is(',')) break;
            this.take();
          } while (true);
          this.take(';');
        }
        this.take('}');
      }
      const existing = name ? this.tags.get(`${kind}:${name}`) : undefined;
      const type = fields
        ? kind === 'struct' ? structType(fields, name) : unionType(fields, name)
        : existing ?? (kind === 'struct' ? structType([], name) : unionType([], name));
      if (name && fields) this.tags.set(`${kind}:${name}`, type);
      return qualifyType(type, typeQualifiers);
    }
    const name = normalizeBuiltinName(words);
    return name ? builtinType(name, typeQualifiers) : typedefType(words.join(' ') || 'int', undefined, typeQualifiers);
  }
  private parseDeclarator(base: CType): Declarator {
    const node = this.parseDeclaratorNode();
    return { name: declaratorName(node), type: this.applyDeclarator(base, node), parameters: node.functionParameters };
  }

  private parseDeclaratorNode(): DeclaratorNode {
    const pointers: MutableQualifiers[] = [];
    while (this.is('*')) {
      this.take();
      const pointerQualifiers: MutableQualifiers = {};
      while (isQualifier(this.peek().text)) {
        pointerQualifiers[this.take().text as keyof TypeQualifiers] = true;
      }
      pointers.push(pointerQualifiers);
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
          params.push({ name: declaratorName(parameter), type: parameterCType, location: this.peek(-1).location });
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
        for (const pointerQualifiers of node.inner.pointers) type = pointerType(type, pointerQualifiers);
        return type;
      }
      let type = this.applyDeclarator(base, node.inner);
      for (let n = node.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.suffixes[n]);
      return type;
    }
    let type = base;
    for (const pointerQualifiers of node.pointers) type = pointerType(type, pointerQualifiers);
    for (let n = node.suffixes.length - 1; n >= 0; n--) type = this.applySuffix(type, node.suffixes[n]);
    return type;
  }

  private applySuffix(type: CType, suffix: DeclaratorSuffix): CType {
    return suffix.kind === 'array'
      ? arrayType(type, suffix.length)
      : functionType(type, suffix.parameters.map(parameter => parameter.type), suffix.variadic);
  }

  private consumeInitializer(): CInitializer | undefined {
    if (!this.is('=')) return undefined;
    this.take();
    return this.parseInitializer();
  }

  private parseInitializer(): CInitializer {
    if (!this.is('{')) return this.parseAssignmentExpression();
    const start = this.take('{');
    const entries: Initializer['entries'][number][] = [];
    while (!this.is('}') && this.peek().kind !== 'eof') {
      const entryLocation = this.peek().location;
      const designators: InitializerDesignator[] = [];
      while (this.is('.') || this.is('[')) {
        if (this.is('.')) {
          this.take();
          const field = this.peek();
          if (field.kind !== 'identifier') throw new CFrontendError('expected field name after initializer designator', field.location);
          this.take();
          designators.push({ kind: 'field-designator', field: field.text, location: field.location });
        } else {
          const location = this.take('[').location;
          const index = this.parseConditionalExpression();
          this.take(']');
          designators.push({ kind: 'index-designator', index, location });
        }
      }
      if (designators.length > 0) this.take('=');
      entries.push({ designators, value: this.parseInitializer(), location: entryLocation });
      if (!this.is(',')) break;
      this.take();
    }
    this.take('}');
    return { kind: 'initializer', entries, location: start.location };
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
    return ['const','volatile','restrict','unsigned','signed','short','long','int','char','void','float','double','struct','union'].includes(this.peek().text)
      || this.peek().kind === 'identifier' && this.typedefs.has(this.peek().text);
  }

  private parseLocalDeclaration(): Statement {
    const start = this.peek();
    const type = this.parseBaseType();
    const declarator = this.parseDeclarator(type);
    if (!declarator.name) throw new CFrontendError('local declaration requires a name', start.location);
    const initializer = this.is('=') ? (this.take(), this.parseInitializer()) : undefined;
    this.take(';');
    return { kind: 'local-declaration', name: declarator.name, type: declarator.type, initializer,
      location: start.location };
  }

  private parseExpression(): Expression {
    return this.parseAssignmentExpression();
  }

  private parseAssignmentExpression(): Expression {
    const left = this.parseConditionalExpression();
    if (!this.is('=')) return left;
    this.take();
    return { kind: 'assignment', target: left, value: this.parseAssignmentExpression(), location: left.location };
  }

  private parseConditionalExpression(): Expression {
    const condition = this.parseBinaryExpression(0);
    if (!this.is('?')) return condition;
    this.take();
    const consequent = this.parseExpression();
    this.take(':');
    return {
      kind: 'conditional',
      condition,
      consequent,
      alternate: this.parseConditionalExpression(),
      location: condition.location,
    };
  }

  private parseBinaryExpression(minimumPrecedence: number): Expression {
    let left = this.parseUnaryExpression();
    while (true) {
      const operator = this.peek().text;
      const precedence = binaryPrecedence(operator);
      if (precedence < minimumPrecedence) return left;
      this.take();
      const right = this.parseBinaryExpression(precedence + 1);
      left = { kind: 'binary', operator, left, right, location: left.location };
    }
  }

  private parseUnaryExpression(): Expression {
    const token = this.peek();
    if (token.text === 'sizeof') {
      this.take();
      if (this.is('(') && this.startsDeclarationAt(1)) {
        this.take('(');
        const typeOperand = this.parseTypeName();
        this.take(')');
        return { kind: 'sizeof', typeOperand, location: token.location };
      }
      return { kind: 'sizeof', expressionOperand: this.parseUnaryExpression(), location: token.location };
    }
    if (token.text === '_Alignof') {
      this.take();
      this.take('(');
      const typeOperand = this.parseTypeName();
      this.take(')');
      return { kind: 'alignof', typeOperand, location: token.location };
    }
    if (['+','-','!','~','&','*'].includes(token.text)) {
      this.take();
      return { kind: 'unary', operator: token.text, operand: this.parseUnaryExpression(), location: token.location };
    }
    return this.parsePostfixExpression();
  }

  private parsePostfixExpression(): Expression {
    let expression = this.parsePrimaryExpression();
    while (true) {
      if (this.is('(')) {
        this.take();
        const args: Expression[] = [];
        while (!this.is(')')) {
          args.push(this.parseAssignmentExpression());
          if (!this.is(',')) break;
          this.take();
        }
        this.take(')');
        expression = { kind: 'call', callee: expression, arguments: args, location: expression.location };
        continue;
      }
      if (this.is('[')) {
        this.take();
        const index = this.parseExpression();
        this.take(']');
        expression = { kind: 'subscript', object: expression, index, location: expression.location };
        continue;
      }
      if (this.is('.') || this.is('->')) {
        const indirect = this.take().text === '->';
        const member = this.peek();
        if (member.kind !== 'identifier') throw new CFrontendError('expected member name', member.location);
        this.take();
        expression = { kind: 'member', object: expression, member: member.text, indirect, location: expression.location };
        continue;
      }
      return expression;
    }
  }

  private parsePrimaryExpression(): Expression {
    const token = this.peek();
    if (token.kind === 'number') {
      this.take();
      const hexadecimal = /^0[xX]/.test(token.text);
      if (/\./.test(token.text) || (hexadecimal ? /[pP]/.test(token.text) : /[eE]/.test(token.text))) {
        const value = Number(token.text.replace(/[fFlL]$/, ''));
        if (!Number.isFinite(value)) throw new CFrontendError(`invalid floating literal '${token.text}'`, token.location);
        return { kind: 'floating-literal', value, precision: /[fF]$/.test(token.text) ? 'float' : 'double', location: token.location };
      }
      const value = token.value ?? Number.parseInt(token.text.replace(/[uUlL]+$/, ''), 0);
      if (!Number.isFinite(value)) throw new CFrontendError(`invalid integer literal '${token.text}'`, token.location);
      return { kind: 'integer-literal', value, location: token.location };
    }
    if (token.kind === 'char') {
      this.take();
      return { kind: 'character-literal', value: decodeQuotedToken(token.text, token.location).codePointAt(0) ?? 0, location: token.location };
    }
    if (token.kind === 'string') {
      this.take();
      return { kind: 'string-literal', value: decodeQuotedToken(token.text, token.location), location: token.location };
    }
    if (token.kind === 'identifier') {
      this.take();
      return { kind: 'identifier', name: token.text, location: token.location };
    }
    if (this.is('(')) {
      this.take();
      const expression = this.parseExpression();
      this.take(')');
      return expression;
    }
    throw new CFrontendError('expected expression', token.location);
  }

  private startsDeclarationAt(offset: number): boolean {
    const token = this.peek(offset);
    return ['const','volatile','restrict','unsigned','signed','short','long','int','char','void','float','double','struct','union'].includes(token.text)
      || token.kind === 'identifier' && this.typedefs.has(token.text);
  }

  private parseTypeName(): CType {
    const base = this.parseBaseType();
    const node = this.parseDeclaratorNode();
    if (node.name) throw new CFrontendError('type name must not declare an identifier', this.peek(-1).location);
    return this.applyDeclarator(base, node);
  }
}

interface DeclaratorNode {
  readonly name?: string;
  readonly pointers: readonly Partial<TypeQualifiers>[];
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

function isQualifier(text: string): text is keyof TypeQualifiers {
  return text === 'const' || text === 'volatile' || text === 'restrict';
}

function declaratorName(node: DeclaratorNode): string | undefined {
  return node.name ?? (node.inner ? declaratorName(node.inner) : undefined);
}

function normalizeBuiltinName(words: readonly string[]): Parameters<typeof builtinType>[0] | undefined {
  if (words.length === 0) return undefined;
  const unsigned = words.includes('unsigned');
  const significant = words.filter(word => word !== 'signed' && word !== 'unsigned' && word !== 'int');
  let base: string;
  if (significant.length === 0) base = 'int';
  else if (significant.every(word => word === 'long')) base = significant.length >= 2 ? 'long long' : 'long';
  else if (significant.length === 2 && significant[0] === 'long' && significant[1] === 'double') base = 'long double';
  else if (significant.length === 1) base = significant[0];
  else return undefined;
  if (unsigned && ['char','short','int','long','long long'].includes(base)) base = `unsigned ${base}`;
  const valid = new Set(['void','char','unsigned char','short','unsigned short','int','unsigned int','long','unsigned long','long long','unsigned long long','float','double','long double']);
  return valid.has(base) ? base as Parameters<typeof builtinType>[0] : undefined;
}

function decodeQuotedToken(text: string, location: Token['location']): string {
  const body = text.slice(1, -1);
  let result = '';
  for (let index = 0; index < body.length; index++) {
    if (body[index] !== '\\') {
      result += body[index];
      continue;
    }
    const escaped = body[++index];
    if (escaped === undefined) throw new CFrontendError('unterminated escape sequence', location);
    const simple: Record<string, string> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
    if (simple[escaped] !== undefined) {
      result += simple[escaped];
      continue;
    }
    if (escaped === 'x') {
      const match = body.slice(index + 1).match(/^[0-9a-fA-F]+/);
      if (!match) throw new CFrontendError('hex escape requires at least one digit', location);
      result += String.fromCodePoint(Number.parseInt(match[0], 16));
      index += match[0].length;
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      const match = body.slice(index).match(/^[0-7]{1,3}/)![0];
      result += String.fromCodePoint(Number.parseInt(match, 8));
      index += match.length - 1;
      continue;
    }
    result += escaped;
  }
  return result;
}
