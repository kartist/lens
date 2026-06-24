// ============================================================
// Lexer — tokenizes Lens source code
// ============================================================

import { SourceLocation, Span } from './ast';

// ---- Token Types ----
export enum TokenKind {
  // Keywords
  SCHEMA = 'SCHEMA',
  TYPE = 'TYPE',
  MAPPING = 'MAPPING',
  BIDIRECTIONAL = 'BIDIRECTIONAL',
  FORWARD = 'FORWARD',
  BACKWARD = 'BACKWARD',
  MATCH = 'MATCH',
  MAP = 'MAP',
  SOURCE = 'SOURCE',
  VIA = 'VIA',
  AS = 'AS',

  // Primitives
  STRING_T = 'STRING_T',
  INT_T = 'INT_T',
  FLOAT_T = 'FLOAT_T',
  BOOL_T = 'BOOL_T',
  DATETIME_T = 'DATETIME_T',
  UUID_T = 'UUID_T',
  DECIMAL_T = 'DECIMAL_T',
  JSON_T = 'JSON_T',

  // Literals
  IDENTIFIER = 'IDENTIFIER',
  STRING_LIT = 'STRING_LIT',
  NUMBER_LIT = 'NUMBER_LIT',
  BOOLEAN_LIT = 'BOOLEAN_LIT',
  NULL_LIT = 'NULL_LIT',
  REGEX_LIT = 'REGEX_LIT',

  // Operators
  DOT = 'DOT',
  ARROW = 'ARROW',        // ->
  FAT_ARROW = 'FAT_ARROW', // =>
  PIPE = 'PIPE',           // |>
  BAR = 'BAR',             // |
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  QUESTION = 'QUESTION',
  COLON = 'COLON',
  AT = 'AT',
  DOUBLE_ARROW = 'DOUBLE_ARROW', // <->

  // Delimiters
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  COMMA = 'COMMA',
  SEMICOLON = 'SEMICOLON',
  EQUALS = 'EQUALS',

  // Special
  EOF = 'EOF',
  ILLEGAL = 'ILLEGAL',
}

export interface Token {
  kind: TokenKind;
  lexeme: string;
  literal?: string | number | boolean | null;
  span: Span;
}

// ---- Keywords map ----
const KEYWORDS: Record<string, TokenKind> = {
  schema: TokenKind.SCHEMA,
  type: TokenKind.TYPE,
  mapping: TokenKind.MAPPING,
  bidirectional: TokenKind.BIDIRECTIONAL,
  forward: TokenKind.FORWARD,
  backward: TokenKind.BACKWARD,
  match: TokenKind.MATCH,
  map: TokenKind.MAP,
  source: TokenKind.SOURCE,
  via: TokenKind.VIA,
  as: TokenKind.AS,
};

const PRIMITIVES: Record<string, TokenKind> = {
  String: TokenKind.STRING_T,
  Int: TokenKind.INT_T,
  Float: TokenKind.FLOAT_T,
  Bool: TokenKind.BOOL_T,
  DateTime: TokenKind.DATETIME_T,
  Uuid: TokenKind.UUID_T,
  Decimal: TokenKind.DECIMAL_T,
  Json: TokenKind.JSON_T,
};

export class Lexer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private col: number = 1;
  private start: number = 0;
  private startLine: number = 1;
  private startCol: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.start = this.pos;
      this.startLine = this.line;
      this.startCol = this.col;
      this.scanToken();
    }

    this.tokens.push(this.makeToken(TokenKind.EOF, ''));
    return this.tokens;
  }

  private scanToken(): void {
    const c = this.advance();

    switch (c) {
      // Whitespace
      case ' ':
      case '\r':
      case '\t':
        break;
      case '\n':
        break;

      // Comments and regex
      case '/':
        if (this.match('/')) {
          // Line comment — skip until end of line
          while (this.peek() !== '\n' && !this.isAtEnd()) this.advance();
        } else {
          // Not a comment — treat as regex literal
          this.regexLiteralFromStart();
        }
        break;

      // Delimiters
      case '{': this.addToken(TokenKind.LBRACE); break;
      case '}': this.addToken(TokenKind.RBRACE); break;
      case '[': this.addToken(TokenKind.LBRACKET); break;
      case ']': this.addToken(TokenKind.RBRACKET); break;
      case '(': this.addToken(TokenKind.LPAREN); break;
      case ')': this.addToken(TokenKind.RPAREN); break;
      case ',': this.addToken(TokenKind.COMMA); break;
      case ';': this.addToken(TokenKind.SEMICOLON); break;
      case ':': this.addToken(TokenKind.COLON); break;
      case '@': this.addToken(TokenKind.AT); break;

      // Operators (multi-char first)
      case '-':
        if (this.match('>')) {
          this.addToken(TokenKind.ARROW);
        } else {
          this.addToken(TokenKind.MINUS);
        }
        break;
      case '<':
        if (this.match('-')) {
          if (this.match('>')) {
            this.addToken(TokenKind.DOUBLE_ARROW);
          } else {
            this.error(`Expected '>' after '<-' for bidirectional arrow`);
          }
        } else {
          this.error(`Unexpected character '<'`);
        }
        break;
      case '=':
        if (this.match('>')) {
          this.addToken(TokenKind.FAT_ARROW);
        } else {
          this.addToken(TokenKind.EQUALS);
        }
        break;
      case '|':
        if (this.match('>')) {
          this.addToken(TokenKind.PIPE);    // |>
        } else {
          this.addToken(TokenKind.BAR);     // |
        }
        break;
      case '.':
        this.addToken(TokenKind.DOT);
        break;
      case '+':
        this.addToken(TokenKind.PLUS);
        break;
      case '?':
        this.addToken(TokenKind.QUESTION);
        break;

      // String literal
      case '"':
        this.stringLiteral('"');
        break;
      case "'":
        this.stringLiteral("'");
        break;

      default:
        if (this.isDigit(c)) {
          this.numberLiteral(c);
        } else if (this.isAlpha(c)) {
          this.identifier(c);
        } else {
          this.error(`Unexpected character '${c}'`);
        }
        break;
    }
  }

  private stringLiteral(quote: string): void {
    let value = '';
    while (this.peek() !== quote && !this.isAtEnd()) {
      if (this.peek() === '\n') {
        this.error('Unterminated string literal');
        return;
      }
      value += this.advance();
    }
    if (this.isAtEnd()) {
      this.error('Unterminated string literal');
      return;
    }
    this.advance(); // consume closing quote
    this.addToken(TokenKind.STRING_LIT, value);
  }

  private regexLiteralFromStart(): void {
    let pattern = '';
    while (this.peek() !== '/' && !this.isAtEnd()) {
      if (this.peek() === '\\') {
        pattern += this.advance();
        if (!this.isAtEnd()) pattern += this.advance();
      } else if (this.peek() === '\n') {
        this.error('Unterminated regex literal');
        return;
      } else {
        pattern += this.advance();
      }
    }
    if (this.isAtEnd()) {
      this.error('Unterminated regex literal');
      return;
    }
    this.advance(); // consume closing /
    this.addToken(TokenKind.REGEX_LIT, pattern);
  }

  private numberLiteral(firstChar: string): void {
    let value = firstChar;
    while (this.isDigit(this.peek())) {
      value += this.advance();
    }
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      value += this.advance(); // consume '.'
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }
      this.addToken(TokenKind.NUMBER_LIT, parseFloat(value));
    } else {
      this.addToken(TokenKind.NUMBER_LIT, parseInt(value, 10));
    }
  }

  private identifier(firstChar: string): void {
    let text = firstChar;
    while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
      text += this.advance();
    }

    // Check keywords
    const keyword = KEYWORDS[text];
    if (keyword) {
      this.addToken(keyword);
      return;
    }

    // Check primitives
    const primitive = PRIMITIVES[text];
    if (primitive) {
      this.addToken(primitive);
      return;
    }

    // Check boolean literals
    if (text === 'true') {
      this.addToken(TokenKind.BOOLEAN_LIT, true);
      return;
    }
    if (text === 'false') {
      this.addToken(TokenKind.BOOLEAN_LIT, false);
      return;
    }
    if (text === 'null') {
      this.addToken(TokenKind.NULL_LIT, null);
      return;
    }

    this.addToken(TokenKind.IDENTIFIER, text);
  }

  // ---- Helpers ----

  private advance(): string {
    const c = this.source[this.pos++];
    if (c === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source[this.pos] !== expected) return false;
    this.pos++;
    this.col++;
    return true;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.pos];
  }

  private peekNext(): string {
    if (this.pos + 1 >= this.source.length) return '\0';
    return this.source[this.pos + 1];
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private isDigit(c: string): boolean {
    return c >= '0' && c <= '9';
  }

  private isAlpha(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  }

  private isAlphaNumeric(c: string): boolean {
    return this.isAlpha(c) || this.isDigit(c);
  }

  private addToken(kind: TokenKind, literal?: string | number | boolean | null): void {
    const lexeme = this.source.slice(this.start, this.pos);
    this.tokens.push({
      kind,
      lexeme,
      literal,
      span: this.currentSpan(),
    });
  }

  private makeToken(kind: TokenKind, lexeme: string): Token {
    return {
      kind,
      lexeme,
      span: this.currentSpan(),
    };
  }

  private currentSpan(): Span {
    return {
      start: { line: this.startLine, column: this.startCol, offset: this.start },
      end: { line: this.line, column: this.col, offset: this.pos },
    };
  }

  private error(message: string): void {
    this.tokens.push({
      kind: TokenKind.ILLEGAL,
      lexeme: this.source.slice(this.start, this.pos),
      span: this.currentSpan(),
    });
    // We could collect errors, but for MVP we push ILLEGAL token
  }
}
