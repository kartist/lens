// ============================================================
// Type System — semantic types for the Lens language
// ============================================================

import {
  TypeExpr, PrimitiveType, NominalType, OptionalType, ArrayType,
  UnionType, RefinedType, SchemaRef, SchemaDecl, TypeAliasDecl,
  TypeAliasDef, MappingDecl, BidirectionalMappingDecl, MappingField,
  MappingExpr, FieldAccessExpr, LiteralExpr, FunctionCallExpr,
  MatchExpr, PipeExpr, BinaryExpr, CoalesceExpr, SubMappingExpr,
  ArrayLiteralExpr, Annotation, Span,
} from '../parser/ast';

// ---- Semantic Types ----
export type SemType =
  | { kind: 'primitive'; name: string }
  | { kind: 'nominal'; name: string }
  | { kind: 'optional'; inner: SemType }
  | { kind: 'array'; inner: SemType }
  | { kind: 'union'; variants: SemType[] }
  | { kind: 'refined'; base: SemType; constraint: string }
  | { kind: 'schema'; name: string; fields: Map<string, FieldType> }
  | { kind: 'error' };

export interface FieldType {
  name: string;
  type: SemType;
  annotations: Annotation[];
}

// ---- Type Environment ----
export interface TypeEnv {
  schemas: Map<string, SchemaType>;
  typeAliases: Map<string, TypeAliasInfo>;
  functions: Map<string, FuncType>;
  mappings: Map<string, MappingInfo>;
}

export interface MappingInfo {
  name: string;
  source: string;
  target: string;
}

export interface SchemaType {
  name: string;
  fields: Map<string, FieldType>;
}

export interface FieldType {
  name: string;
  type: SemType;
  annotations: Annotation[];
}

export interface TypeAliasInfo {
  name: string;
  semType: SemType;
}

export interface FuncType {
  name: string;
  paramTypes: SemType[];
  returnType: SemType;
}

// ---- Build type environment from AST ----
export function buildTypeEnv(declarations: {
  schemas: SchemaDecl[];
  typeAliases: TypeAliasDecl[];
  mappings: { name: string; source: string; target: string }[];
}): TypeEnv {
  const schemas = new Map<string, SchemaType>();
  const typeAliases = new Map<string, TypeAliasInfo>();

  // First pass: collect type aliases
  for (const ta of declarations.typeAliases) {
    typeAliases.set(ta.name, {
      name: ta.name,
      semType: resolveTypeAliasDef(ta.definition),
    });
  }

  // Second pass: collect schemas
  for (const schema of declarations.schemas) {
    const fields = new Map<string, FieldType>();
    for (const f of schema.fields) {
      fields.set(f.name, {
        name: f.name,
        type: resolveTypeExpr(f.type, typeAliases),
        annotations: f.annotations,
      });
    }
    schemas.set(schema.name, { name: schema.name, fields });
  }

  // Built-in functions
  const functions = builtinFunctions();

  // Collect mapping info
  const mappings = new Map<string, MappingInfo>();
  for (const m of declarations.mappings) {
    mappings.set(m.name, { name: m.name, source: m.source, target: m.target });
  }

  return { schemas, typeAliases, functions, mappings };
}

function resolveTypeExpr(type: TypeExpr, aliases: Map<string, TypeAliasInfo>): SemType {
  switch (type.kind) {
    case 'primitive':
      return { kind: 'primitive', name: type.name };
    case 'nominal': {
      // Check if it's a type alias
      const alias = aliases.get(type.name);
      if (alias) return alias.semType;
      // Otherwise treat as nominal type
      return { kind: 'nominal', name: type.name };
    }
    case 'optional':
      return { kind: 'optional', inner: resolveTypeExpr(type.inner, aliases) };
    case 'array':
      return { kind: 'array', inner: resolveTypeExpr(type.inner, aliases) };
    case 'union':
      return {
        kind: 'union',
        variants: type.variants.map(v => resolveTypeExpr(v, aliases)),
      };
    case 'refined':
      return {
        kind: 'refined',
        base: resolveTypeExpr(type.base, aliases),
        constraint: type.constraint,
      };
    case 'schema_ref':
      return { kind: 'schema', name: type.name, fields: new Map() }; // resolved later
    default:
      return { kind: 'error' };
  }
}

function resolveTypeAliasDef(def: TypeAliasDef): SemType {
  switch (def.kind) {
    case 'alias_regex':
      return { kind: 'refined', base: { kind: 'primitive', name: 'String' }, constraint: def.pattern };
    case 'alias_union':
      return {
        kind: 'union',
        variants: def.variants.map(v => ({ kind: 'nominal', name: v })),
      };
    case 'alias_wrapper':
      return resolveTypeExpr(def.inner, new Map());
  }
}

// ---- Built-in Functions ----
function builtinFunctions(): Map<string, FuncType> {
  const fns = new Map<string, FuncType>();

  const str: SemType = { kind: 'primitive', name: 'String' };
  const int: SemType = { kind: 'primitive', name: 'Int' };
  const dt: SemType = { kind: 'primitive', name: 'DateTime' };
  const uuidT: SemType = { kind: 'primitive', name: 'Uuid' };
  const arrOptStr: SemType = { kind: 'array', inner: { kind: 'optional', inner: str } };
  const arrStr: SemType = { kind: 'array', inner: str };

  fns.set('trim', { name: 'trim', paramTypes: [str], returnType: str });
  fns.set('title_case', { name: 'title_case', paramTypes: [str], returnType: str });
  fns.set('lowercase', { name: 'lowercase', paramTypes: [str], returnType: str });
  fns.set('uppercase', { name: 'uppercase', paramTypes: [str], returnType: str });
  fns.set('normalize_email', { name: 'normalize_email', paramTypes: [str], returnType: str });
  fns.set('normalize_city', { name: 'normalize_city', paramTypes: [str], returnType: str });
  fns.set('parse_uuid', { name: 'parse_uuid', paramTypes: [str], returnType: uuidT });
  fns.set('parse_int', { name: 'parse_int', paramTypes: [str], returnType: int });
  fns.set('now', { name: 'now', paramTypes: [], returnType: dt });
  fns.set('to_string', { name: 'to_string', paramTypes: [str], returnType: str });  // accepts any input
  fns.set('filter_none', { name: 'filter_none', paramTypes: [arrOptStr], returnType: arrStr });
  fns.set('split_first', { name: 'split_first', paramTypes: [str], returnType: str });
  fns.set('split_last', { name: 'split_last', paramTypes: [str], returnType: str });

  return fns;
}

// ---- String representation for errors ----
export function semTypeToString(t: SemType): string {
  switch (t.kind) {
    case 'primitive': return t.name;
    case 'nominal': return t.name;
    case 'optional': return `${semTypeToString(t.inner)}?`;
    case 'array': return `${semTypeToString(t.inner)}[]`;
    case 'union': return t.variants.map(semTypeToString).join(' | ');
    case 'refined': return `${semTypeToString(t.base)}/${t.constraint}/`;
    case 'schema': return t.name;
    case 'error': return '<error>';
  }
}
