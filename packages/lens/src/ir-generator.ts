// ============================================================
// IR Generator — produces IR from checked AST + TypeEnv
// ============================================================

import {
  Document, SchemaDecl, TypeAliasDecl, MappingDecl,
  BidirectionalMappingDecl, MappingField, MappingExpr,
  FieldAccessExpr, LiteralExpr, FunctionCallExpr, MatchExpr,
  PipeExpr, BinaryExpr, CoalesceExpr, SubMappingExpr,
  ArrayLiteralExpr, MatchArm, Annotation, TypeExpr,
} from './parser/ast';
import {
  TypeEnv, SchemaType, FieldType, SemType,
  buildTypeEnv, semTypeToString, FuncType,
} from './checker/types';
import {
  IRDocument, IRSchema, IRSchemaField, IRAnnotation,
  IRTypeAlias, IRMapping, IRMappingField, IRExpr,
  IRFieldAccess, IRLiteral, IRFunctionCall, IRMatch,
  IRMatchArm, IRPipe, IRBinary, IRCoalesce, IRSubMapping,
  IRArrayLiteral, IResolvedType,
} from './ir';

// ---- Public API ----
export function generateIR(document: Document): IRDocument {
  const schemas: SchemaDecl[] = [];
  const typeAliases: TypeAliasDecl[] = [];
  const mappings: MappingDecl[] = [];
  const bidirMappings: BidirectionalMappingDecl[] = [];

  for (const decl of document.declarations) {
    switch (decl.kind) {
      case 'schema_decl': schemas.push(decl); break;
      case 'type_alias_decl': typeAliases.push(decl); break;
      case 'mapping_decl': mappings.push(decl); break;
      case 'bidirectional_mapping_decl': bidirMappings.push(decl); break;
    }
  }

  const env = buildTypeEnv({
    schemas,
    typeAliases,
    mappings: [
      ...mappings.map(m => ({ name: m.name, source: m.source, target: m.target })),
      ...bidirMappings.map(m => ({ name: m.name, source: m.source, target: m.target })),
    ],
  });

  const irSchemas = schemas.map(s => convertSchema(s, env));
  const irAliases = typeAliases.map(t => convertTypeAlias(t, env));
  const irMappings = mappings.map(m => convertMapping(m, env));
  const irBidir = bidirMappings.map(m => convertBidirectionalMapping(m, env));

  return {
    schemas: irSchemas,
    typeAliases: irAliases,
    mappings: irMappings,
    bidirectionalMappings: irBidir,
  };
}

// ---- Schema Conversion ----
function convertSchema(schema: SchemaDecl, env: TypeEnv): IRSchema {
  const fields: IRSchemaField[] = schema.fields.map(f => ({
    name: f.name,
    type: convertTypeExpr(f.type, env),
    annotations: f.annotations.map(convertAnnotation),
  }));
  return { name: schema.name, fields };
}

function convertAnnotation(ann: Annotation): IRAnnotation {
  return {
    name: ann.name,
    args: ann.args.map(a => a.value),
  };
}

// ---- Type Alias Conversion ----
function convertTypeAlias(ta: TypeAliasDecl, env: TypeEnv): IRTypeAlias {
  const alias = env.typeAliases.get(ta.name);
  const resolvedType = alias?.semType ?? { kind: 'error' as const };
  const ir: IRTypeAlias = {
    name: ta.name,
    resolvedType: convertSemType(resolvedType),
    defKind: 'wrapper',
  };

  switch (ta.definition.kind) {
    case 'alias_regex':
      ir.defKind = 'regex';
      ir.pattern = ta.definition.pattern;
      break;
    case 'alias_union':
      ir.defKind = 'union';
      ir.variants = ta.definition.variants;
      break;
    case 'alias_wrapper':
      ir.defKind = 'wrapper';
      break;
  }
  return ir;
}

// ---- Mapping Conversion ----
function convertMapping(mapping: MappingDecl, env: TypeEnv): IRMapping {
  const sourceSchema = env.schemas.get(mapping.source);
  const fields: IRMappingField[] = sourceSchema
    ? mapping.fields.map(f => convertMappingField(f, sourceSchema, env))
    : [];

  const result: IRMapping = {
    name: mapping.name,
    source: mapping.source,
    target: mapping.target,
    isBidirectional: false,
    fields,
  };

  if (mapping.backwardFields && mapping.backwardFields.length > 0) {
    result.isBidirectional = true;
    const targetSchema = env.schemas.get(mapping.target);
    result.backwardFields = targetSchema
      ? mapping.backwardFields.map(f => convertMappingField(f, targetSchema, env))
      : [];
  }

  return result;
}

function convertBidirectionalMapping(
  mapping: BidirectionalMappingDecl,
  env: TypeEnv,
): IRMapping {
  const sourceSchema = env.schemas.get(mapping.source);
  const targetSchema = env.schemas.get(mapping.target);

  return {
    name: mapping.name,
    source: mapping.source,
    target: mapping.target,
    isBidirectional: true,
    fields: sourceSchema
      ? mapping.forward.fields.map(f => convertMappingField(f, sourceSchema, env))
      : [],
    backwardFields: targetSchema
      ? mapping.backward.fields.map(f => convertMappingField(f, targetSchema, env))
      : [],
  };
}

function convertMappingField(
  field: MappingField,
  sourceSchema: SchemaType,
  env: TypeEnv,
): IRMappingField {
  return {
    name: field.name,
    expression: convertExpr(field.expression, sourceSchema, env),
  };
}

// ---- Expression Conversion ----
function convertExpr(
  expr: MappingExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
): IRExpr {
  const resolvedType = resolveExprType(expr, sourceSchema, env);

  switch (expr.kind) {
    case 'field_access':
      return { kind: 'field_access', path: expr.path, resolvedType: convertSemType(resolvedType) };
    case 'literal':
      return { kind: 'literal', value: expr.value, resolvedType: convertSemType(resolvedType) };
    case 'function_call':
      return {
        kind: 'function_call',
        name: expr.name,
        args: expr.args.map(a => convertExpr(a, sourceSchema, env)),
        resolvedType: convertSemType(resolvedType),
      };
    case 'match':
      return {
        kind: 'match',
        subject: convertExpr(expr.subject, sourceSchema, env),
        arms: expr.arms.map(a => convertMatchArm(a, sourceSchema, env)),
        defaultArm: expr.defaultArm
          ? convertExpr(expr.defaultArm, sourceSchema, env)
          : undefined,
        resolvedType: convertSemType(resolvedType),
      };
    case 'pipe':
      return {
        kind: 'pipe',
        left: convertExpr(expr.left, sourceSchema, env),
        right: convertExpr(expr.right, sourceSchema, env),
        resolvedType: convertSemType(resolvedType),
      };
    case 'binary':
      return {
        kind: 'binary',
        left: convertExpr(expr.left, sourceSchema, env),
        operator: expr.operator,
        right: convertExpr(expr.right, sourceSchema, env),
        resolvedType: convertSemType(resolvedType),
      };
    case 'coalesce':
      return {
        kind: 'coalesce',
        expr: convertExpr(expr.expr, sourceSchema, env),
        resolvedType: convertSemType(resolvedType),
      };
    case 'sub_mapping':
      return {
        kind: 'sub_mapping',
        mappingName: expr.mappingName,
        resolvedType: convertSemType(resolvedType),
      };
    case 'array_literal':
      return {
        kind: 'array_literal',
        elements: expr.elements.map(e => convertExpr(e, sourceSchema, env)),
        resolvedType: convertSemType(resolvedType),
      };
  }
}

function convertMatchArm(
  arm: MatchArm,
  sourceSchema: SchemaType,
  env: TypeEnv,
): IRMatchArm {
  let patterns: (string | number | boolean)[] = [];
  if (arm.pattern.kind === 'literal_pattern') {
    patterns = [arm.pattern.value];
  } else if (arm.pattern.kind === 'multi_pattern') {
    patterns = arm.pattern.values;
  }
  // wildcard_pattern → empty patterns array (default)
  return {
    patterns,
    body: convertExpr(arm.body, sourceSchema, env),
  };
}

// ---- Type Resolution (mirrors checker's checkMappingExpr) ----
function resolveExprType(
  expr: MappingExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
): SemType {
  const errorType: SemType = { kind: 'error' };

  switch (expr.kind) {
    case 'field_access':
      return resolveFieldAccessType(expr, sourceSchema);
    case 'literal':
      return resolveLiteralType(expr);
    case 'function_call': {
      const fn = env.functions.get(expr.name);
      return fn ? fn.returnType : errorType;
    }
    case 'match': {
      // Return type from first arm (all arms should be compatible)
      if (expr.arms.length > 0) {
        return resolveExprType(expr.arms[0].body, sourceSchema, env);
      }
      if (expr.defaultArm) {
        return resolveExprType(expr.defaultArm, sourceSchema, env);
      }
      return errorType;
    }
    case 'pipe': {
      if (expr.right.kind === 'function_call') {
        const fn = env.functions.get(expr.right.name);
        return fn ? fn.returnType : errorType;
      }
      return errorType;
    }
    case 'binary': {
      const leftType = resolveExprType(expr.left, sourceSchema, env);
      return leftType; // + on strings returns string
    }
    case 'coalesce':
      return resolveExprType(expr.expr, sourceSchema, env);
    case 'sub_mapping': {
      const mappingInfo = env.mappings.get(expr.mappingName);
      if (mappingInfo) {
        const targetSchema = env.schemas.get(mappingInfo.target);
        if (targetSchema) {
          return { kind: 'schema', name: mappingInfo.target, fields: targetSchema.fields };
        }
      }
      return errorType;
    }
    case 'array_literal': {
      if (expr.elements.length > 0) {
        const elemType = resolveExprType(expr.elements[0], sourceSchema, env);
        return { kind: 'array', inner: elemType };
      }
      return { kind: 'array', inner: { kind: 'primitive', name: 'String' } };
    }
  }
}

function resolveFieldAccessType(
  expr: FieldAccessExpr,
  sourceSchema: SchemaType,
): SemType {
  let path = expr.path;
  const errorType: SemType = { kind: 'error' };

  if (path.length > 0 && path[0] === 'source') {
    if (path.length === 1) {
      return { kind: 'schema', name: sourceSchema.name, fields: sourceSchema.fields };
    }
    path = path.slice(1);
  }

  let currentType: SemType = { kind: 'schema', name: sourceSchema.name, fields: sourceSchema.fields };

  for (let i = 0; i < path.length; i++) {
    const fieldName = path[i];
    if (currentType.kind === 'schema') {
      const field = currentType.fields.get(fieldName);
      if (!field) {
        if (path.length === 1) return { kind: 'nominal', name: fieldName };
        return errorType;
      }
      currentType = field.type;
    } else if (currentType.kind === 'optional' && currentType.inner.kind === 'schema') {
      const nestedField: FieldType | undefined = currentType.inner.fields.get(fieldName);
      if (!nestedField) {
        if (path.length === 1) return { kind: 'nominal', name: fieldName };
        return errorType;
      }
      currentType = nestedField.type;
    } else {
      return errorType;
    }
  }
  return currentType;
}

function resolveLiteralType(expr: LiteralExpr): SemType {
  if (typeof expr.value === 'string') return { kind: 'primitive', name: 'String' };
  if (typeof expr.value === 'number') {
    return Number.isInteger(expr.value)
      ? { kind: 'primitive', name: 'Int' }
      : { kind: 'primitive', name: 'Float' };
  }
  if (typeof expr.value === 'boolean') return { kind: 'primitive', name: 'Bool' };
  if (expr.value === null) return { kind: 'optional', inner: { kind: 'primitive', name: 'String' } };
  return { kind: 'error' };
}

// ---- Type Conversion ----
function convertTypeExpr(type: TypeExpr, env: TypeEnv): IResolvedType {
  switch (type.kind) {
    case 'primitive':
      return { kind: 'primitive', name: type.name };
    case 'nominal': {
      // Keep type alias name as-is — backends can decide to inline or reference
      return { kind: 'nominal', name: type.name };
    }
    case 'optional':
      return { kind: 'optional', inner: convertTypeExpr(type.inner, env) };
    case 'array':
      return { kind: 'array', inner: convertTypeExpr(type.inner, env) };
    case 'union':
      return { kind: 'union', variants: type.variants.map(v => convertTypeExpr(v, env)) };
    case 'refined':
      return { kind: 'refined', base: convertTypeExpr(type.base, env), constraint: type.constraint };
    case 'schema_ref':
      return { kind: 'schema_ref', name: type.name };
  }
}

function convertSemType(st: SemType): IResolvedType {
  switch (st.kind) {
    case 'primitive': return { kind: 'primitive', name: st.name };
    case 'nominal': return { kind: 'nominal', name: st.name };
    case 'optional': return { kind: 'optional', inner: convertSemType(st.inner) };
    case 'array': return { kind: 'array', inner: convertSemType(st.inner) };
    case 'union': return { kind: 'union', variants: st.variants.map(convertSemType) };
    case 'refined': return { kind: 'refined', base: convertSemType(st.base), constraint: st.constraint };
    case 'schema': return { kind: 'schema_ref', name: st.name };
    case 'error': return { kind: 'primitive', name: 'String' }; // fallback
  }
}

function convertSemTypeString(st: SemType): string {
  return semTypeToString(st);
}
