// ============================================================
// Lexer Tests — covers tokenization of Lens source code
// ============================================================
import { describe, it, expect } from 'vitest';
import { Lexer, TokenKind } from '../src/parser';

function tokens(source: string) {
  return new Lexer(source).tokenize();
}

function kinds(source: string) {
  return tokens(source).map(t => t.kind);
}

function lexemes(source: string) {
  return tokens(source).map(t => t.lexeme);
}

function literals(source: string) {
  return tokens(source).map(t => t.literal);
}

describe('Lexer', () => {
  // ---- Keywords ----
  it('tokenizes keyword: schema', () => {
    expect(kinds('schema')).toEqual([TokenKind.SCHEMA, TokenKind.EOF]);
  });

  it('tokenizes keyword: type', () => {
    expect(kinds('type')).toEqual([TokenKind.TYPE, TokenKind.EOF]);
  });

  it('tokenizes keyword: mapping', () => {
    expect(kinds('mapping')).toEqual([TokenKind.MAPPING, TokenKind.EOF]);
  });

  it('tokenizes keyword: bidirectional', () => {
    expect(kinds('bidirectional')).toEqual([TokenKind.BIDIRECTIONAL, TokenKind.EOF]);
  });

  it('tokenizes keyword: match', () => {
    expect(kinds('match')).toEqual([TokenKind.MATCH, TokenKind.EOF]);
  });

  it('tokenizes keyword: map, source, via, as', () => {
    expect(kinds('map source via as')).toEqual([
      TokenKind.MAP, TokenKind.SOURCE, TokenKind.VIA, TokenKind.AS, TokenKind.EOF,
    ]);
  });

  it('tokenizes forward/backward keywords', () => {
    expect(kinds('forward backward')).toEqual([
      TokenKind.FORWARD, TokenKind.BACKWARD, TokenKind.EOF,
    ]);
  });

  // ---- Primitive Types ----
  it('tokenizes primitive types', () => {
    const src = 'String Int Float Bool DateTime Uuid Decimal Json';
    expect(kinds(src)).toEqual([
      TokenKind.STRING_T, TokenKind.INT_T, TokenKind.FLOAT_T,
      TokenKind.BOOL_T, TokenKind.DATETIME_T, TokenKind.UUID_T,
      TokenKind.DECIMAL_T, TokenKind.JSON_T, TokenKind.EOF,
    ]);
  });

  // ---- Literals ----
  it('tokenizes string literals (double quotes)', () => {
    const ts = tokens('"hello world"');
    expect(ts[0].kind).toBe(TokenKind.STRING_LIT);
    expect(ts[0].literal).toBe('hello world');
  });

  it('tokenizes string literals (single quotes)', () => {
    const ts = tokens("'hello'");
    expect(ts[0].kind).toBe(TokenKind.STRING_LIT);
    expect(ts[0].literal).toBe('hello');
  });

  it('tokenizes integer literals', () => {
    const ts = tokens('42');
    expect(ts[0].kind).toBe(TokenKind.NUMBER_LIT);
    expect(ts[0].literal).toBe(42);
  });

  it('tokenizes float literals', () => {
    const ts = tokens('3.14');
    expect(ts[0].kind).toBe(TokenKind.NUMBER_LIT);
    expect(ts[0].literal).toBe(3.14);
  });

  it('tokenizes boolean literals', () => {
    const t = tokens('true false');
    expect(t[0].kind).toBe(TokenKind.BOOLEAN_LIT);
    expect(t[0].literal).toBe(true);
    expect(t[1].kind).toBe(TokenKind.BOOLEAN_LIT);
    expect(t[1].literal).toBe(false);
  });

  it('tokenizes null literal', () => {
    const ts = tokens('null');
    expect(ts[0].kind).toBe(TokenKind.NULL_LIT);
    expect(ts[0].literal).toBe(null);
  });

  it('tokenizes regex literals', () => {
    const ts = tokens('/^[a-z]+$/');
    expect(ts[0].kind).toBe(TokenKind.REGEX_LIT);
    expect(ts[0].literal).toBe('^[a-z]+$');
  });

  // ---- Operators ----
  it('tokenizes arrow ->', () => {
    expect(kinds('->')).toEqual([TokenKind.ARROW, TokenKind.EOF]);
  });

  it('tokenizes fat arrow =>', () => {
    expect(kinds('=>')).toEqual([TokenKind.FAT_ARROW, TokenKind.EOF]);
  });

  it('tokenizes pipe |>', () => {
    expect(kinds('|>')).toEqual([TokenKind.PIPE, TokenKind.EOF]);
  });

  it('tokenizes bar |', () => {
    expect(kinds('|')).toEqual([TokenKind.BAR, TokenKind.EOF]);
  });

  it('tokenizes double arrow <->', () => {
    expect(kinds('<->')).toEqual([TokenKind.DOUBLE_ARROW, TokenKind.EOF]);
  });

  it('tokenizes plus/minus operators', () => {
    expect(kinds('+ -')).toEqual([TokenKind.PLUS, TokenKind.MINUS, TokenKind.EOF]);
  });

  it('tokenizes question mark', () => {
    expect(kinds('?')).toEqual([TokenKind.QUESTION, TokenKind.EOF]);
  });

  // ---- Delimiters ----
  it('tokenizes braces, brackets, parens', () => {
    expect(kinds('{} [] ()')).toEqual([
      TokenKind.LBRACE, TokenKind.RBRACE,
      TokenKind.LBRACKET, TokenKind.RBRACKET,
      TokenKind.LPAREN, TokenKind.RPAREN,
      TokenKind.EOF,
    ]);
  });

  it('tokenizes other delimiters', () => {
    expect(kinds(', ; : @ . =')).toEqual([
      TokenKind.COMMA, TokenKind.SEMICOLON, TokenKind.COLON,
      TokenKind.AT, TokenKind.DOT, TokenKind.EQUALS,
      TokenKind.EOF,
    ]);
  });

  // ---- Identifiers ----
  it('tokenizes identifiers', () => {
    const ts = tokens('myField customer_name foo123');
    expect(ts[0].kind).toBe(TokenKind.IDENTIFIER);
    expect(ts[0].lexeme).toBe('myField');
    expect(ts[1].lexeme).toBe('customer_name');
    expect(ts[2].lexeme).toBe('foo123');
  });

  // ---- Comments ----
  it('skips line comments', () => {
    const ts = tokens('// this is a comment\nschema');
    expect(ts[0].kind).toBe(TokenKind.SCHEMA);
  });

  // ---- Source locations ----
  it('tracks source locations', () => {
    const ts = tokens('schema Foo {\n  name: String\n}');
    const schemaTok = ts[0];
    expect(schemaTok.span.start.line).toBe(1);
    expect(schemaTok.span.start.column).toBe(1);
  });

  // ---- Complex example ----
  it('tokenizes a complete schema declaration', () => {
    const src = 'schema Customer {\n  name: String @required\n  age: Int?\n}';
    const ks = kinds(src);
    expect(ks).toEqual([
      TokenKind.SCHEMA, TokenKind.IDENTIFIER,     // schema Customer
      TokenKind.LBRACE,                            // {
      TokenKind.IDENTIFIER, TokenKind.COLON,       // name:
      TokenKind.STRING_T, TokenKind.AT, TokenKind.IDENTIFIER, // String @required
      TokenKind.IDENTIFIER, TokenKind.COLON,       // age:
      TokenKind.INT_T, TokenKind.QUESTION,          // Int?
      TokenKind.RBRACE,                             // }
      TokenKind.EOF,
    ]);
  });
});
