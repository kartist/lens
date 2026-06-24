// ============================================================
// Parser Tests — covers AST generation from Lens source code
// ============================================================
import { describe, it, expect } from 'vitest';
import { Parser } from '../src/parser';
import * as fs from 'fs';

function parse(source: string) {
  return new Parser().parse(source);
}

function ok(source: string) {
  const r = parse(source);
  return { doc: r.document, errors: r.errors.length, hasError: r.errors.length > 0 };
}

describe('Parser', () => {
  // ---- Schema Declarations ----
  it('parses a simple schema', () => {
    const { doc, errors } = ok('schema Foo { name: String }');
    expect(errors).toBe(0);
    expect(doc.declarations).toHaveLength(1);
    const s = doc.declarations[0];
    expect(s.kind).toBe('schema_decl');
    if (s.kind === 'schema_decl') {
      expect(s.name).toBe('Foo');
      expect(s.fields).toHaveLength(1);
      expect(s.fields[0].name).toBe('name');
      expect(s.fields[0].type.kind).toBe('primitive');
    }
  });

  it('parses schema with multiple fields', () => {
    const { doc, errors } = ok(`schema Customer {
      id: String
      name: String
      age: Int
    }`);
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      expect(s.fields).toHaveLength(3);
      expect(s.fields.map(f => f.name)).toEqual(['id', 'name', 'age']);
    }
  });

  it('parses optional type with ?', () => {
    const { doc, errors } = ok('schema Foo { name: String? }');
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      expect(s.fields[0].type.kind).toBe('optional');
    }
  });

  it('parses array type with []', () => {
    const { doc, errors } = ok('schema Foo { tags: String[] }');
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      expect(s.fields[0].type.kind).toBe('array');
    }
  });

  it('parses schema field with nominal type reference', () => {
    const { doc, errors } = ok('schema Foo { status: CustomerStatus }');
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      expect(s.fields[0].type.kind).toBe('nominal');
      if (s.fields[0].type.kind === 'nominal') {
        expect(s.fields[0].type.name).toBe('CustomerStatus');
      }
    }
  });

  it('parses schema with annotations', () => {
    const { doc, errors } = ok('schema Foo { name: String @required @max(200) }');
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      const anns = s.fields[0].annotations;
      expect(anns).toHaveLength(2);
      expect(anns[0].name).toBe('required');
      expect(anns[1].name).toBe('max');
      expect(anns[1].args[0].value).toBe(200);
    }
  });

  it('parses schema with @id and @auto', () => {
    const { doc, errors } = ok('schema Foo { id: Uuid @id @auto }');
    expect(errors).toBe(0);
    const s = doc.declarations[0];
    if (s.kind === 'schema_decl') {
      expect(s.fields[0].type.kind).toBe('primitive');
    }
  });

  it('parses refined type alias (regex)', () => {
    const { doc, errors } = ok('type Email = /^[^@]+@/');
    expect(errors).toBe(0);
    expect(doc.declarations[0].kind).toBe('type_alias_decl');
    const ta = doc.declarations[0];
    if (ta.kind === 'type_alias_decl') {
      expect(ta.definition.kind).toBe('alias_regex');
    }
  });

  // ---- Type Aliases ----
  it('parses regex type alias', () => {
    const { doc, errors } = ok('type Email = /^[^@]+@[^@]+\\.[^@]+$/');
    expect(errors).toBe(0);
    expect(doc.declarations[0].kind).toBe('type_alias_decl');
    const ta = doc.declarations[0];
    if (ta.kind === 'type_alias_decl') {
      expect(ta.name).toBe('Email');
      expect(ta.definition.kind).toBe('alias_regex');
    }
  });

  it('parses union type alias', () => {
    const { doc, errors } = ok('type Status = active | inactive | suspended');
    expect(errors).toBe(0);
    const ta = doc.declarations[0];
    if (ta.kind === 'type_alias_decl') {
      expect(ta.name).toBe('Status');
      expect(ta.definition.kind).toBe('alias_union');
      if (ta.definition.kind === 'alias_union') {
        expect(ta.definition.variants).toEqual(['active', 'inactive', 'suspended']);
      }
    }
  });

  it('parses wrapper type alias', () => {
    const { doc, errors } = ok('type Phone = String');
    expect(errors).toBe(0);
    const ta = doc.declarations[0];
    if (ta.kind === 'type_alias_decl') {
      expect(ta.definition.kind).toBe('alias_wrapper');
    }
  });

  // ---- Mappings ----
  it('parses a simple mapping', () => {
    const { doc, errors } = ok('mapping Foo : A -> B { x = source.y }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.name).toBe('Foo');
      expect(m.source).toBe('A');
      expect(m.target).toBe('B');
      expect(m.fields).toHaveLength(1);
      expect(m.fields[0].name).toBe('x');
      expect(m.fields[0].expression.kind).toBe('field_access');
    }
  });

  it('parses mapping with pipe expression', () => {
    const { doc, errors } = ok('mapping M : S -> T { name = source.full_name |> trim |> title_case }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      const expr = m.fields[0].expression;
      expect(expr.kind).toBe('pipe');
    }
  });

  it('parses mapping with match expression', () => {
    const src = `mapping M : S -> T {
      status = match source.code {
        "A" => active
        _    => inactive
      }
    }`;
    const { doc, errors } = ok(src);
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.fields[0].expression.kind).toBe('match');
    }
  });

  it('parses mapping with function call', () => {
    const { doc, errors } = ok('mapping M : S -> T { x = now() }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.fields[0].expression.kind).toBe('function_call');
    }
  });

  it('parses mapping with sub-mapping', () => {
    const { doc, errors } = ok('mapping M : S -> T { addr = map source via AddressMapping }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.fields[0].expression.kind).toBe('sub_mapping');
    }
  });

  it('parses mapping with array literal', () => {
    const { doc, errors } = ok('mapping M : S -> T { phones = [source.phone1?, source.phone2?] }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.fields[0].expression.kind).toBe('array_literal');
    }
  });

  it('parses mapping with coalesce (?) operator', () => {
    const { doc, errors } = ok('mapping M : S -> T { x = source.y? }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      expect(m.fields[0].expression.kind).toBe('coalesce');
    }
  });

  it('parses mapping with binary + operator', () => {
    const { doc, errors } = ok('mapping M : S -> T { name = source.first + " " + source.last }');
    expect(errors).toBe(0);
    const m = doc.declarations[0];
    if (m.kind === 'mapping_decl') {
      // Should be parsed as two binary expressions
      expect(m.fields[0].expression.kind).toBe('binary');
    }
  });

  // ---- Bidirectional Mappings ----
  it('parses a bidirectional mapping', () => {
    const src = `bidirectional Sync : Order <-> ExternalOrder {
      forward { order_id = source.id }
      backward { id = source.order_id }
    }`;
    const { doc, errors } = ok(src);
    expect(errors).toBe(0);
    expect(doc.declarations[0].kind).toBe('bidirectional_mapping_decl');
    const bm = doc.declarations[0];
    if (bm.kind === 'bidirectional_mapping_decl') {
      expect(bm.name).toBe('Sync');
      expect(bm.forward.fields).toHaveLength(1);
      expect(bm.backward.fields).toHaveLength(1);
    }
  });

  // ---- Multiple Declarations ----
  it('parses multiple top-level declarations', () => {
    const src = `
      type Status = active | inactive
      schema Foo { name: String }
      mapping M : Foo -> Bar { name = source.name }
    `;
    const { doc, errors } = ok(src);
    expect(errors).toBe(0);
    expect(doc.declarations).toHaveLength(3);
    expect(doc.declarations.map(d => d.kind)).toEqual([
      'type_alias_decl', 'schema_decl', 'mapping_decl',
    ]);
  });

  // ---- Error recovery ----
  it('reports parse errors for invalid input', () => {
    const r = parse('!!invalid!!');
    expect(r.errors.length).toBeGreaterThan(0);
  });

  // ---- Complete customer.lens ----
  it('parses customer.lens example without errors', () => {
    const src = fs.readFileSync('examples/customer.lens', 'utf-8');
    const r = parse(src);
    expect(r.errors).toHaveLength(0);
    expect(r.document.declarations.length).toBeGreaterThanOrEqual(6);
  });

  it('parses order.lens example without errors', () => {
    const src = fs.readFileSync('examples/order.lens', 'utf-8');
    const r = parse(src);
    expect(r.errors).toHaveLength(0);
    expect(r.document.declarations.length).toBeGreaterThanOrEqual(3);
  });
});
