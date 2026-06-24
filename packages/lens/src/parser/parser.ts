// ============================================================
// Parser — recursive descent parser for Lens DSL
// ============================================================

import {
  Document, Declaration, SchemaDecl, SchemaField, TypeExpr,
  PrimitiveType, NominalType, OptionalType, ArrayType, UnionType,
  RefinedType, SchemaRef, Annotation, AnnotationArg,
  TypeAliasDecl, TypeAliasDef,
  MappingDecl, MappingField, MappingExpr, MappingBlock,
  BidirectionalMappingDecl,
  FieldAccessExpr, LiteralExpr, FunctionCallExpr, MatchExpr,
  MatchArm, MatchPattern, PipeExpr, BinaryExpr, ArrayLiteralExpr,
  SubMappingExpr, CoalesceExpr, Span,
} from './ast';
import { Lexer, Token, TokenKind } from './lexer';

export class ParseError extends Error {
  severity: 'error' = 'error';
  constructor(message: string, public span: Span) {
    super(message);
    this.name = 'ParseError';
  }
}

export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;
  private errors: ParseError[] = [];

  parse(source: string): { document: Document; errors: ParseError[] } {
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
    this.pos = 0;
    this.errors = [];

    const document = this.parseDocument();

    return { document, errors: this.errors };
  }

  // ---- Document ----
  private parseDocument(): Document {
    const declarations: Declaration[] = [];
    while (!this.isAtEnd()) {
      try {
        const decl = this.parseDeclaration();
        if (decl) declarations.push(decl);
      } catch (e) {
        if (e instanceof ParseError) {
          this.errors.push(e);
          this.synchronize();
        } else {
          throw e;
        }
      }
    }
    return { kind: 'document', declarations };
  }

  // ---- Declarations ----
  private parseDeclaration(): Declaration | null {
    switch (this.peek().kind) {
      case TokenKind.SCHEMA:
        return this.parseSchemaDecl();
      case TokenKind.TYPE:
        return this.parseTypeAliasDecl();
      case TokenKind.MAPPING:
        return this.parseMappingDecl();
      case TokenKind.BIDIRECTIONAL:
        return this.parseBidirectionalMappingDecl();
      case TokenKind.EOF:
        return null;
      default:
        throw this.error(`Unexpected token '${this.peek().lexeme}' at top level`);
    }
  }

  // ---- Schema Declaration ----
  private parseSchemaDecl(): SchemaDecl {
    const start = this.advance(); // 'schema'
    const name = this.consume(TokenKind.IDENTIFIER, 'Expected schema name');
    this.consume(TokenKind.LBRACE, "Expected '{' after schema name");

    const fields: SchemaField[] = [];
    while (this.peek().kind !== TokenKind.RBRACE && !this.isAtEnd()) {
      fields.push(this.parseSchemaField());
    }

    const end = this.consume(TokenKind.RBRACE, "Expected '}' after schema fields");
    return {
      kind: 'schema_decl',
      name: name.lexeme,
      fields,
      span: this.spanFrom(start, end),
    };
  }

  private parseSchemaField(): SchemaField {
    const nameTok = this.consume(TokenKind.IDENTIFIER, 'Expected field name');
    this.consume(TokenKind.COLON, "Expected ':' after field name");

    const type = this.parseTypeExpr();
    const annotations = this.parseAnnotations();

    return {
      name: nameTok.lexeme,
      type,
      annotations,
      span: this.spanFrom(nameTok, this.previous()),
    };
  }

  // ---- Type Expressions ----
  private parseTypeExpr(): TypeExpr {
    const tok = this.peek();

    // Optional: check for trailing ?
    // Parsing order: base type → optional modifier → array modifier

    let type = this.parseBaseType();

    // Check for ?
    if (this.peek().kind === TokenKind.QUESTION) {
      this.advance();
      type = { kind: 'optional', inner: type, span: this.spanFrom(tok, this.previous()) };
    }

    // Check for []
    if (this.peek().kind === TokenKind.LBRACKET && this.peekNext()?.kind === TokenKind.RBRACKET) {
      this.advance(); // [
      this.advance(); // ]
      type = { kind: 'array', inner: type, span: this.spanFrom(tok, this.previous()) };
    }

    return type;
  }

  private parseBaseType(): TypeExpr {
    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.STRING_T:
      case TokenKind.INT_T:
      case TokenKind.FLOAT_T:
      case TokenKind.BOOL_T:
      case TokenKind.DATETIME_T:
      case TokenKind.UUID_T:
      case TokenKind.DECIMAL_T:
      case TokenKind.JSON_T: {
        this.advance();
        const name = tok.kind === TokenKind.STRING_T ? 'String' :
                     tok.kind === TokenKind.INT_T ? 'Int' :
                     tok.kind === TokenKind.FLOAT_T ? 'Float' :
                     tok.kind === TokenKind.BOOL_T ? 'Bool' :
                     tok.kind === TokenKind.DATETIME_T ? 'DateTime' :
                     tok.kind === TokenKind.UUID_T ? 'Uuid' :
                     tok.kind === TokenKind.DECIMAL_T ? 'Decimal' : 'Json';
        const prim: PrimitiveType = { kind: 'primitive', name: name as PrimitiveType['name'], span: tok.span };
        return prim;
      }

      case TokenKind.IDENTIFIER: {
        // Could be a nominal type or schema reference — treat identifiers
        // that start with uppercase as schema refs, lowercase as nominal types
        // Actually, let's just check context later. For now, all identifiers are nominal.
        this.advance();
        
        // Check if it's a regex-refined type: Email = /pattern/
        // But at field type position, it's just a nominal type
        const nom: NominalType = { kind: 'nominal', name: tok.lexeme, span: tok.span };
        return nom;
      }

      case TokenKind.REGEX_LIT: {
        this.advance();
        // A bare regex at type position means a refined type on String
        const refined: RefinedType = {
          kind: 'refined',
          base: { kind: 'primitive', name: 'String', span: tok.span },
          constraint: tok.literal as string,
          span: tok.span,
        };
        return refined;
      }

      case TokenKind.LPAREN: {
        // Union type or parenthesized — but union requires pipe, we don't support inline unions in MVP yet
        this.advance(); // (
        const inner = this.parseTypeExpr();
        this.consume(TokenKind.RPAREN, "Expected ')'");
        return inner;
      }

      default:
        throw this.error(`Expected type, got '${tok.lexeme}'`);
    }
  }

  // ---- Annotations ----
  private parseAnnotations(): Annotation[] {
    const annotations: Annotation[] = [];
    while (this.peek().kind === TokenKind.AT) {
      const start = this.advance(); // @
      const name = this.consume(TokenKind.IDENTIFIER, 'Expected annotation name');

      const args: AnnotationArg[] = [];
      if (this.peek().kind === TokenKind.LPAREN) {
        this.advance(); // (
        if (this.peek().kind !== TokenKind.RPAREN) {
          args.push(this.parseAnnotationArg());
          while (this.peek().kind === TokenKind.COMMA) {
            this.advance();
            args.push(this.parseAnnotationArg());
          }
        }
        this.consume(TokenKind.RPAREN, "Expected ')' after annotation args");
      }

      annotations.push({
        kind: 'annotation',
        name: name.lexeme,
        args,
        span: this.spanFrom(start, this.previous()),
      });
    }
    return annotations;
  }

  private parseAnnotationArg(): AnnotationArg {
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.STRING_LIT:
        this.advance();
        return { kind: 'arg_string', value: tok.literal as string };
      case TokenKind.NUMBER_LIT:
        this.advance();
        return { kind: 'arg_number', value: tok.literal as number };
      case TokenKind.BOOLEAN_LIT:
        this.advance();
        return { kind: 'arg_boolean', value: tok.literal as boolean };
      case TokenKind.IDENTIFIER:
        this.advance();
        return { kind: 'arg_identifier', value: tok.lexeme };
      case TokenKind.REGEX_LIT:
        this.advance();
        return { kind: 'arg_regex', value: tok.literal as string };
      default:
        throw this.error(`Expected annotation argument, got '${tok.lexeme}'`);
    }
  }

  // ---- Type Alias ----
  private parseTypeAliasDecl(): TypeAliasDecl {
    const start = this.advance(); // 'type'
    const name = this.consume(TokenKind.IDENTIFIER, 'Expected type alias name');
    this.consume(TokenKind.EQUALS, "Expected '=' in type alias");

    const definition = this.parseTypeAliasDef();
    const end = this.previous();

    return {
      kind: 'type_alias_decl',
      name: name.lexeme,
      definition,
      span: this.spanFrom(start, end),
    };
  }

  private parseTypeAliasDef(): TypeAliasDef {
    const tok = this.peek();

    if (tok.kind === TokenKind.REGEX_LIT) {
      this.advance();
      return {
        kind: 'alias_regex',
        pattern: tok.literal as string,
        span: tok.span,
      };
    }

    // Primitive type token: type Phone = String
    if (isPrimitiveToken(tok.kind)) {
      this.advance();
      const name = primitiveTokenName(tok.kind);
      return {
        kind: 'alias_wrapper',
        inner: { kind: 'primitive', name: name as PrimitiveType['name'], span: tok.span },
        span: tok.span,
      };
    }

    // String literal: type CountryCode = "CN" | "US" | ...
    if (tok.kind === TokenKind.STRING_LIT) {
      this.advance();
      const variants: string[] = [tok.literal as string];
      while (this.peek().kind === TokenKind.BAR) {
        this.advance(); // |
        const v = this.consume(TokenKind.STRING_LIT, 'Expected string literal after |');
        variants.push(v.literal as string);
      }
      return {
        kind: 'alias_union',
        variants,
        span: this.spanFrom(tok, this.previous()),
      };
    }

    // Identifier: type Status = active | inactive | ...
    if (tok.kind === TokenKind.IDENTIFIER) {
      this.advance();
      // Check for union: Type = A | B | C
      if (this.peek().kind === TokenKind.BAR) {
        const variants: string[] = [tok.lexeme];
        while (this.peek().kind === TokenKind.BAR) {
          this.advance(); // |
          const v = this.consume(TokenKind.IDENTIFIER, 'Expected variant name');
          variants.push(v.lexeme);
        }
        return {
          kind: 'alias_union',
          variants,
          span: this.spanFrom(tok, this.previous()),
        };
      }

      // Wrapper type: Type = SomeNamedType
      return {
        kind: 'alias_wrapper',
        inner: { kind: 'nominal', name: tok.lexeme, span: tok.span },
        span: tok.span,
      };
    }

    throw this.error(`Expected type definition, got '${tok.lexeme}'`);
  }

  // ---- Mapping Declaration ----
  private parseMappingDecl(): MappingDecl {
    const start = this.advance(); // 'mapping'
    const name = this.consume(TokenKind.IDENTIFIER, 'Expected mapping name');
    this.consume(TokenKind.COLON, "Expected ':' after mapping name");
    const source = this.consume(TokenKind.IDENTIFIER, 'Expected source schema name');
    this.consume(TokenKind.ARROW, "Expected '->' in mapping signature");
    const target = this.consume(TokenKind.IDENTIFIER, 'Expected target schema name');
    this.consume(TokenKind.LBRACE, "Expected '{' to start mapping body");

    const fields = this.parseMappingFields();
    
    const end = this.consume(TokenKind.RBRACE, "Expected '}' after mapping body");

    return {
      kind: 'mapping_decl',
      name: name.lexeme,
      source: source.lexeme,
      target: target.lexeme,
      fields,
      isBidirectional: false,
      span: this.spanFrom(start, end),
    };
  }

  // ---- Bidirectional Mapping ----
  private parseBidirectionalMappingDecl(): BidirectionalMappingDecl {
    const start = this.advance(); // 'bidirectional'
    const name = this.consume(TokenKind.IDENTIFIER, 'Expected mapping name');
    this.consume(TokenKind.COLON, "Expected ':' after mapping name");
    const source = this.consume(TokenKind.IDENTIFIER, 'Expected source schema name');
    this.consume(TokenKind.DOUBLE_ARROW, "Expected '<->' in bidirectional mapping");
    const target = this.consume(TokenKind.IDENTIFIER, 'Expected target schema name');
    this.consume(TokenKind.LBRACE, "Expected '{' to start mapping body");

    // Parse forward block
    this.consume(TokenKind.FORWARD, "Expected 'forward' block");
    this.consume(TokenKind.LBRACE, "Expected '{' after 'forward'");
    const forwardFields = this.parseMappingFields();
    const forwardEnd = this.consume(TokenKind.RBRACE, "Expected '}' after forward block");

    // Parse backward block
    this.consume(TokenKind.BACKWARD, "Expected 'backward' block");
    this.consume(TokenKind.LBRACE, "Expected '{' after 'backward'");
    const backwardFields = this.parseMappingFields();
    const backwardEnd = this.consume(TokenKind.RBRACE, "Expected '}' after backward block");

    const end = this.consume(TokenKind.RBRACE, "Expected '}' after bidirectional mapping");

    return {
      kind: 'bidirectional_mapping_decl',
      name: name.lexeme,
      source: source.lexeme,
      target: target.lexeme,
      forward: { fields: forwardFields, span: this.spanFrom(start, forwardEnd) },
      backward: { fields: backwardFields, span: this.spanFrom(start, backwardEnd) },
      span: this.spanFrom(start, end),
    };
  }

  private parseMappingFields(): MappingField[] {
    const fields: MappingField[] = [];
    while (this.peek().kind === TokenKind.IDENTIFIER) {
      fields.push(this.parseMappingField());
    }
    return fields;
  }

  private parseMappingField(): MappingField {
    const nameTok = this.consume(TokenKind.IDENTIFIER, 'Expected field name');
    this.consume(TokenKind.EQUALS, "Expected '=' in field mapping");
    const expr = this.parseMappingExpr();
    return {
      name: nameTok.lexeme,
      expression: expr,
      span: this.spanFrom(nameTok, this.previous()),
    };
  }

  // ---- Mapping Expressions (Operator precedence climbing) ----
  private parseMappingExpr(): MappingExpr {
    return this.parsePipe();
  }

  // Pipe has lowest precedence: a |> b |> c
  // After |>, the function name may optionally be followed by (args)
  private parsePipe(): MappingExpr {
    let left = this.parseBinary();

    while (this.peek().kind === TokenKind.PIPE) {
      const pipeTok = this.advance(); // |>
      // After |>, expect function name
      const funcName = this.consume(TokenKind.IDENTIFIER, 'Expected function name after |>');

      let funcCall: FunctionCallExpr;
      if (this.peek().kind === TokenKind.LPAREN) {
        // Function with extra args: |> func(arg1, arg2)
        funcCall = this.parseFunctionCallWithName(funcName.lexeme, pipeTok.span);
      } else {
        // Simple function reference: |> func — no extra args
        funcCall = {
          kind: 'function_call',
          name: funcName.lexeme,
          args: [],
          span: this.spanFrom(pipeTok, funcName),
        };
      }

      left = {
        kind: 'pipe',
        left,
        right: funcCall,
        span: this.spanFromToken(this.previous()),
      } as PipeExpr;
    }

    return left;
  }

  // Binary: a + b
  private parseBinary(): MappingExpr {
    let left = this.parseCoalesce();

    while (this.peek().kind === TokenKind.PLUS || this.peek().kind === TokenKind.MINUS) {
      const opTok = this.advance();
      const right = this.parseCoalesce();
      left = {
        kind: 'binary',
        left,
        operator: opTok.kind === TokenKind.PLUS ? '+' : '-',
        right,
        span: this.spanFromToken(this.previous()),
      } as BinaryExpr;
    }

    return left;
  }

  // Coalesce (postfix ?)
  private parseCoalesce(): MappingExpr {
    let expr = this.parseAtomic();

    while (this.peek().kind === TokenKind.QUESTION) {
      this.advance();
      expr = {
        kind: 'coalesce',
        expr,
        span: this.spanFromToken(this.previous()),
      } as CoalesceExpr;
    }

    return expr;
  }

  // Atomic expressions
  private parseAtomic(): MappingExpr {
    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.SOURCE:
        return this.parseFieldAccess();

      case TokenKind.IDENTIFIER:
        return this.parseIdentifierExpr();

      case TokenKind.STRING_LIT:
      case TokenKind.NUMBER_LIT:
      case TokenKind.BOOLEAN_LIT:
      case TokenKind.NULL_LIT:
        this.advance();
        return {
          kind: 'literal',
          value: tok.literal ?? tok.lexeme,
          span: tok.span,
        } as LiteralExpr;

      case TokenKind.MATCH:
        return this.parseMatchExpr();

      case TokenKind.MAP:
        return this.parseSubMappingExpr();

      case TokenKind.LBRACKET:
        return this.parseArrayLiteral();

      case TokenKind.LPAREN:
        this.advance(); // (
        const inner = this.parseMappingExpr();
        this.consume(TokenKind.RPAREN, "Expected ')'");
        return inner;

      default:
        throw this.error(`Expected expression, got '${tok.lexeme}'`);
    }
  }

  // Field access: source.field.subfield — includes 'source' as first path element
  private parseFieldAccess(): FieldAccessExpr {
    const start = this.advance(); // 'source'
    this.consume(TokenKind.DOT, "Expected '.' after 'source'");
    
    const path: string[] = ['source'];
    path.push(this.consume(TokenKind.IDENTIFIER, 'Expected field name after source.').lexeme);

    while (this.peek().kind === TokenKind.DOT) {
      this.advance(); // .
      path.push(this.consume(TokenKind.IDENTIFIER, 'Expected field name after .').lexeme);
    }

    return {
      kind: 'field_access',
      path,
      span: this.spanFrom(start, this.previous()),
    };
  }

  // Identifier at start of expression: could be function call or field access
  private parseIdentifierExpr(): MappingExpr {
    const nameTok = this.advance(); // consume identifier

    if (this.peek().kind === TokenKind.LPAREN) {
      // Function call: func_name(arg1, arg2)
      this.advance(); // (
      return this.finishFunctionCall(nameTok.lexeme, nameTok.span);
    }

    if (this.peek().kind === TokenKind.DOT) {
      // This could be source.field OR namespace.func — but we already handle source.
      // Treat as field access starting with this identifier
      const path: string[] = [nameTok.lexeme];
      while (this.peek().kind === TokenKind.DOT) {
        this.advance();
        path.push(this.consume(TokenKind.IDENTIFIER, 'Expected identifier after .').lexeme);
      }
      return {
        kind: 'field_access',
        path,
        span: this.spanFrom(nameTok, this.previous()),
      } as FieldAccessExpr;
    }

    // Standalone identifier — could be a variable reference. For MVP, treat as field access.
    return {
      kind: 'field_access',
      path: [nameTok.lexeme],
      span: nameTok.span,
    } as FieldAccessExpr;
  }

  private parseFunctionCallWithName(name: string, startSpan: Span): FunctionCallExpr {
    this.consume(TokenKind.LPAREN, `Expected '(' after function name '${name}'`);
    const args: MappingExpr[] = [];
    if (this.peek().kind !== TokenKind.RPAREN) {
      args.push(this.parseMappingExpr());
      while (this.peek().kind === TokenKind.COMMA) {
        this.advance();
        args.push(this.parseMappingExpr());
      }
    }
    const end = this.consume(TokenKind.RPAREN, "Expected ')' after function arguments");
    return {
      kind: 'function_call',
      name,
      args,
      span: this.spanFromToken(end),
    };
  }

  private finishFunctionCall(name: string, startSpan: Span): FunctionCallExpr {
    const args: MappingExpr[] = [];
    if (this.peek().kind !== TokenKind.RPAREN) {
      args.push(this.parseMappingExpr());
      while (this.peek().kind === TokenKind.COMMA) {
        this.advance();
        args.push(this.parseMappingExpr());
      }
    }
    const end = this.consume(TokenKind.RPAREN, "Expected ')' after function arguments");

    return {
      kind: 'function_call',
      name,
      args,
      span: this.spanFromToken(end),
    };
  }

  // Match expression
  private parseMatchExpr(): MatchExpr {
    const start = this.advance(); // 'match'
    const subject = this.parseMappingExpr();
    this.consume(TokenKind.LBRACE, "Expected '{' after match subject");

    const arms: MatchArm[] = [];
    let defaultArm: MappingExpr | undefined;

    while (this.peek().kind !== TokenKind.RBRACE && !this.isAtEnd()) {
      if (this.peek().kind === TokenKind.ARROW) {
        // This would be ->, but we use FAT_ARROW (=>) for match arms
        throw this.error("Expected '=>' in match arm, not '->'");
      }

      const pattern = this.parseMatchPattern();
      
      // Check for default wildcard
      if (pattern.kind === 'wildcard_pattern') {
        this.consume(TokenKind.FAT_ARROW, "Expected '=>' after match pattern");
        defaultArm = this.parseMappingExpr();
        break; // _ must be the last arm
      }

      this.consume(TokenKind.FAT_ARROW, "Expected '=>' after match pattern");
      const body = this.parseMappingExpr();
      arms.push({ pattern, body, span: this.spanFrom(start, this.previous()) });
    }

    const end = this.consume(TokenKind.RBRACE, "Expected '}' after match expression");

    return {
      kind: 'match',
      subject,
      arms,
      defaultArm,
      span: this.spanFrom(start, end),
    };
  }

  private parseMatchPattern(): MatchPattern {
    const tok = this.peek();

    if (tok.kind === TokenKind.ARROW) {
      throw this.error("Unexpected '->' in match pattern. Use '_' for wildcard or a literal.");
    }

    if (tok.kind === TokenKind.STRING_LIT) {
      this.advance();
      const literals: (string | number | boolean)[] = [tok.literal as string];
      // Check for multi-pattern: "A" | "B" | "C"
      while (this.peek().kind === TokenKind.BAR) {
        this.advance(); // |
        const next = this.consume(TokenKind.STRING_LIT, 'Expected literal after | in match pattern');
        literals.push(next.literal as string);
      }
      if (literals.length === 1) {
        return { kind: 'literal_pattern', value: literals[0] };
      }
      return { kind: 'multi_pattern', values: literals };
    }

    if (tok.kind === TokenKind.NUMBER_LIT) {
      this.advance();
      return { kind: 'literal_pattern', value: tok.literal as number };
    }

    if (tok.kind === TokenKind.BOOLEAN_LIT) {
      this.advance();
      return { kind: 'literal_pattern', value: tok.literal as boolean };
    }

    // Wildcard
    if (tok.kind === TokenKind.MINUS && this.peekNext()?.kind === TokenKind.IDENTIFIER) {
      // This shouldn't happen — let's check for underscore
      throw this.error("Expected literal or '_' in match pattern");
    }
    
    // Check if it's an identifier — could be a variant name
    // In MVP, match arms use literal values or wildcard
    if (tok.lexeme === '_') {
      this.advance();
      return { kind: 'wildcard_pattern' };
    }

    if (tok.kind === TokenKind.IDENTIFIER) {
      this.advance();
      // Treat as variant name literal
      const variants: string[] = [tok.lexeme];
      while (this.peek().kind === TokenKind.BAR) {
        this.advance(); // |
        const next = this.consume(TokenKind.IDENTIFIER, 'Expected variant after | in match pattern');
        variants.push(next.lexeme);
      }
      if (variants.length === 1) {
        return { kind: 'literal_pattern', value: variants[0] };
      }
      return { kind: 'multi_pattern', values: variants };
    }

    throw this.error(`Expected match pattern, got '${tok.lexeme}'`);
  }

  // Sub-mapping: map source via MappingName
  private parseSubMappingExpr(): SubMappingExpr {
    const start = this.advance(); // 'map'
    this.consume(TokenKind.SOURCE, "Expected 'source' after 'map'");
    this.consume(TokenKind.VIA, "Expected 'via' after 'map source'");
    const name = this.consume(TokenKind.IDENTIFIER, 'Expected mapping name after via');
    return {
      kind: 'sub_mapping',
      mappingName: name.lexeme,
      span: this.spanFrom(start, name),
    };
  }

  // Array literal: [elem1, elem2, ...]
  private parseArrayLiteral(): ArrayLiteralExpr {
    const start = this.advance(); // [
    const elements: MappingExpr[] = [];

    if (this.peek().kind !== TokenKind.RBRACKET) {
      elements.push(this.parseMappingExpr());
      while (this.peek().kind === TokenKind.COMMA) {
        this.advance();
        elements.push(this.parseMappingExpr());
      }
    }

    this.consume(TokenKind.RBRACKET, "Expected ']' after array elements");
    return {
      kind: 'array_literal',
      elements,
      span: this.spanFrom(start, this.previous()),
    };
  }

  // ---- Helpers ----

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.EOF, lexeme: '', span: this.emptySpan() };
  }

  private peekNext(): Token | null {
    return this.tokens[this.pos + 1] ?? null;
  }

  private advance(): Token {
    const tok = this.peek();
    if (tok.kind !== TokenKind.EOF) {
      this.pos++;
    }
    return tok;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.peek();
  }

  private consume(kind: TokenKind, errorMessage: string): Token {
    if (this.peek().kind === kind) {
      return this.advance();
    }
    throw this.error(errorMessage);
  }

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.EOF;
  }

  private error(message: string): ParseError {
    const tok = this.peek();
    const span = tok.span;
    return new ParseError(
      `${message} (at line ${span.start.line}, col ${span.start.column})`,
      span
    );
  }

  private synchronize(): void {
    // Skip tokens until we find something that looks like a declaration boundary
    const syncTokens = new Set([
      TokenKind.SCHEMA, TokenKind.TYPE, TokenKind.MAPPING,
      TokenKind.BIDIRECTIONAL,
    ]);

    while (!this.isAtEnd()) {
      if (syncTokens.has(this.peek().kind)) {
        return;
      }
      this.advance();
    }
  }

  private spanFrom(start: Token, end: Token): Span {
    return {
      start: start.span.start,
      end: end.span.end,
    };
  }

  private spanFromToken(tok: Token): Span {
    return tok.span;
  }

  private emptySpan(): Span {
    return {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    };
  }
}

// ---- Helper functions ----

function isPrimitiveToken(kind: TokenKind): boolean {
  return kind === TokenKind.STRING_T ||
    kind === TokenKind.INT_T ||
    kind === TokenKind.FLOAT_T ||
    kind === TokenKind.BOOL_T ||
    kind === TokenKind.DATETIME_T ||
    kind === TokenKind.UUID_T ||
    kind === TokenKind.DECIMAL_T ||
    kind === TokenKind.JSON_T;
}

function primitiveTokenName(kind: TokenKind): string {
  switch (kind) {
    case TokenKind.STRING_T: return 'String';
    case TokenKind.INT_T: return 'Int';
    case TokenKind.FLOAT_T: return 'Float';
    case TokenKind.BOOL_T: return 'Bool';
    case TokenKind.DATETIME_T: return 'DateTime';
    case TokenKind.UUID_T: return 'Uuid';
    case TokenKind.DECIMAL_T: return 'Decimal';
    case TokenKind.JSON_T: return 'Json';
    default: return 'String';
  }
}
