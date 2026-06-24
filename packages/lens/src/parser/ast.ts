// ============================================================
// Lens AST — the core data structures of the Lens language
// ============================================================

// ---- Source Locations ----
export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface Span {
  start: SourceLocation;
  end: SourceLocation;
}

// ---- The Document (top-level compilation unit) ----
export interface Document {
  kind: 'document';
  declarations: Declaration[];
}

export type Declaration =
  | SchemaDecl
  | TypeAliasDecl
  | MappingDecl
  | BidirectionalMappingDecl;

// ============================================================
// SCHEMA DEFINITIONS
// ============================================================

export interface SchemaDecl {
  kind: 'schema_decl';
  name: string;
  fields: SchemaField[];
  span: Span;
}

export interface SchemaField {
  name: string;
  type: TypeExpr;
  annotations: Annotation[];
  span: Span;
}

// ---- Types ----
export type TypeExpr =
  | PrimitiveType
  | NominalType
  | OptionalType
  | ArrayType
  | UnionType
  | RefinedType
  | SchemaRef;

export interface PrimitiveType {
  kind: 'primitive';
  name: 'String' | 'Int' | 'Float' | 'Bool' | 'DateTime' | 'Uuid' | 'Decimal' | 'Json';
  span: Span;
}

export interface NominalType {
  kind: 'nominal';
  name: string; // e.g. Email, Phone, CountryCode
  span: Span;
}

export interface OptionalType {
  kind: 'optional';
  inner: TypeExpr;
  span: Span;
}

export interface ArrayType {
  kind: 'array';
  inner: TypeExpr;
  span: Span;
}

export interface UnionType {
  kind: 'union';
  variants: TypeExpr[];
  span: Span;
}

export interface RefinedType {
  kind: 'refined';
  base: TypeExpr;
  constraint: string; // regex pattern or literal constraint
  span: Span;
}

export interface SchemaRef {
  kind: 'schema_ref';
  name: string;
  span: Span;
}

// ---- Annotations ----
export type Annotation =
  | { kind: 'annotation'; name: string; args: AnnotationArg[]; span: Span };

export type AnnotationArg =
  | { kind: 'arg_string'; value: string }
  | { kind: 'arg_number'; value: number }
  | { kind: 'arg_boolean'; value: boolean }
  | { kind: 'arg_identifier'; value: string }
  | { kind: 'arg_regex'; value: string };

// ============================================================
// TYPE ALIASES
// ============================================================

export interface TypeAliasDecl {
  kind: 'type_alias_decl';
  name: string;
  definition: TypeAliasDef;
  span: Span;
}

export type TypeAliasDef =
  | { kind: 'alias_regex'; pattern: string; span: Span }
  | { kind: 'alias_union'; variants: string[]; span: Span }
  | { kind: 'alias_wrapper'; inner: TypeExpr; span: Span };

// ============================================================
// MAPPING DEFINITIONS
// ============================================================

export interface MappingDecl {
  kind: 'mapping_decl';
  name: string;
  source: string;   // source schema name
  target: string;   // target schema name
  fields: MappingField[];
  isBidirectional: boolean;
  backwardFields?: MappingField[];
  span: Span;
}

export interface BidirectionalMappingDecl {
  kind: 'bidirectional_mapping_decl';
  name: string;
  source: string;
  target: string;
  forward: MappingBlock;
  backward: MappingBlock;
  span: Span;
}

export interface MappingBlock {
  fields: MappingField[];
  span: Span;
}

export type MappingField = {
  name: string;       // target field name
  expression: MappingExpr;
  span: Span;
};

// ---- Mapping Expressions ----
export type MappingExpr =
  | FieldAccessExpr
  | LiteralExpr
  | FunctionCallExpr
  | MatchExpr
  | PipeExpr
  | BinaryExpr
  | ArrayLiteralExpr
  | SubMappingExpr
  | CoalesceExpr;

export interface FieldAccessExpr {
  kind: 'field_access';
  path: string[];     // e.g. ['source', 'contact', 'email_addr']
  span: Span;
}

export interface LiteralExpr {
  kind: 'literal';
  value: string | number | boolean | null;
  span: Span;
}

export interface FunctionCallExpr {
  kind: 'function_call';
  name: string;
  args: MappingExpr[];
  span: Span;
}

export interface MatchExpr {
  kind: 'match';
  subject: MappingExpr;
  arms: MatchArm[];
  defaultArm?: MappingExpr;
  span: Span;
}

export interface MatchArm {
  pattern: MatchPattern;
  body: MappingExpr;
  span: Span;
}

export type MatchPattern =
  | { kind: 'literal_pattern'; value: string | number | boolean }
  | { kind: 'wildcard_pattern' }
  | { kind: 'multi_pattern'; values: (string | number | boolean)[] };

export interface PipeExpr {
  kind: 'pipe';
  left: MappingExpr;
  right: MappingExpr;  // right is a function_call that takes left as first arg
  span: Span;
}

export interface BinaryExpr {
  kind: 'binary';
  left: MappingExpr;
  operator: '+' | '-';
  right: MappingExpr;
  span: Span;
}

export interface ArrayLiteralExpr {
  kind: 'array_literal';
  elements: MappingExpr[];
  span: Span;
}

export interface SubMappingExpr {
  kind: 'sub_mapping';
  mappingName: string;
  span: Span;
}

export interface CoalesceExpr {
  kind: 'coalesce';
  expr: MappingExpr;
  span: Span;  // the ? postfix operator — makes nulls propagate
}
