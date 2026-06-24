// ============================================================
// Type Checker — validates Lens programs semantically
// ============================================================

import {
  Document, SchemaDecl, TypeAliasDecl, MappingDecl,
  BidirectionalMappingDecl, MappingField, MappingExpr,
  FieldAccessExpr, LiteralExpr, FunctionCallExpr, MatchExpr,
  PipeExpr, BinaryExpr, CoalesceExpr, SubMappingExpr,
  ArrayLiteralExpr, MatchArm, Span,
} from '../parser/ast';
import {
  TypeEnv, SchemaType, FieldType, SemType,
  buildTypeEnv, semTypeToString, FuncType,
} from './types';

// ---- Check Error ----
export interface CheckError {
  message: string;
  span: Span;
  severity: 'error' | 'warning';
}

// ---- Check Result ----
export interface CheckResult {
  errors: CheckError[];
  warnings: CheckError[];
}

export function check(document: Document): CheckResult {
  const errors: CheckError[] = [];
  const warnings: CheckError[] = [];

  // Separate declarations
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

  // Check each mapping
  for (const mapping of mappings) {
    checkMapping(mapping, env, errors, warnings);
  }

  for (const bidir of bidirMappings) {
    checkBidirectionalMapping(bidir, env, errors, warnings);
  }

  return { errors, warnings };
}

// ---- Check Mapping ----
function checkMapping(
  mapping: MappingDecl,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): void {
  // Verify source schema exists
  const sourceSchema = env.schemas.get(mapping.source);
  if (!sourceSchema) {
    errors.push({
      message: `Source schema '${mapping.source}' not found`,
      span: mapping.span,
      severity: 'error',
    });
    return;
  }

  // Verify target schema exists
  const targetSchema = env.schemas.get(mapping.target);
  if (!targetSchema) {
    errors.push({
      message: `Target schema '${mapping.target}' not found`,
      span: mapping.span,
      severity: 'error',
    });
    return;
  }

  // Check each field mapping
  const mappedTargetFields = new Set<string>();

  for (const field of mapping.fields) {
    // Check target field exists
    const targetField = targetSchema.fields.get(field.name);
    if (!targetField) {
      errors.push({
        message: `Field '${field.name}' does not exist on target schema '${mapping.target}'`,
        span: field.span,
        severity: 'error',
      });
      continue;
    }
    mappedTargetFields.add(field.name);

    // Check expression type against target field type
    const exprType = checkMappingExpr(field.expression, sourceSchema, env, errors, warnings);
    if (exprType.kind === 'error') continue;

    // Type compatibility check
    if (!isTypeCompatible(exprType, targetField.type, env)) {
      errors.push({
        message: `Type mismatch for field '${field.name}': expected '${semTypeToString(targetField.type)}', got '${semTypeToString(exprType)}'`,
        span: field.span,
        severity: 'error',
      });
    }

    // Check if source has @immutable and this mapping is trying to set it
    for (const ann of targetField.annotations) {
      if (ann.name === 'immutable') {
        warnings.push({
          message: `Field '${field.name}' is marked @immutable in target — mapping may be inappropriate`,
          span: field.span,
          severity: 'warning',
        });
      }
    }
  }

  // Check for required fields not covered
  for (const [name, f] of targetSchema.fields) {
    if (!mappedTargetFields.has(name) && !hasAnnotation(f, 'auto') && !hasAnnotation(f, 'audit')) {
      const isOptional = f.type.kind === 'optional';
      if (!isOptional) {
        errors.push({
          message: `Required field '${name}' of target schema '${mapping.target}' is not mapped`,
          span: mapping.span,
          severity: 'error',
        });
      } else {
        warnings.push({
          message: `Optional field '${name}' of target schema '${mapping.target}' is not mapped`,
          span: mapping.span,
          severity: 'warning',
        });
      }
    }
  }
}

// ---- Check Bidirectional Mapping ----
function checkBidirectionalMapping(
  mapping: BidirectionalMappingDecl,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): void {
  const sourceSchema = env.schemas.get(mapping.source);
  const targetSchema = env.schemas.get(mapping.target);

  if (!sourceSchema) {
    errors.push({ message: `Source schema '${mapping.source}' not found`, span: mapping.span, severity: 'error' });
    return;
  }
  if (!targetSchema) {
    errors.push({ message: `Target schema '${mapping.target}' not found`, span: mapping.span, severity: 'error' });
    return;
  }

  // Check forward: source -> target
  for (const field of mapping.forward.fields) {
    const targetField = targetSchema.fields.get(field.name);
    if (!targetField) {
      errors.push({
        message: `Field '${field.name}' does not exist on target schema '${mapping.target}'`,
        span: field.span,
        severity: 'error',
      });
      continue;
    }
    const exprType = checkMappingExpr(field.expression, sourceSchema, env, errors, warnings);
    if (exprType.kind !== 'error' && !isTypeCompatible(exprType, targetField.type, env)) {
      errors.push({
        message: `[forward] Type mismatch for field '${field.name}': expected '${semTypeToString(targetField.type)}', got '${semTypeToString(exprType)}'`,
        span: field.span,
        severity: 'error',
      });
    }
  }

  // Check backward: target -> source
  for (const field of mapping.backward.fields) {
    const sourceField = sourceSchema.fields.get(field.name);
    if (!sourceField) {
      errors.push({
        message: `Field '${field.name}' does not exist on source schema '${mapping.source}'`,
        span: field.span,
        severity: 'error',
      });
      continue;
    }
    const exprType = checkMappingExpr(field.expression, targetSchema, env, errors, warnings);
    if (exprType.kind !== 'error' && !isTypeCompatible(exprType, sourceField.type, env)) {
      errors.push({
        message: `[backward] Type mismatch for field '${field.name}': expected '${semTypeToString(sourceField.type)}', got '${semTypeToString(exprType)}'`,
        span: field.span,
        severity: 'error',
      });
    }
  }
}

// ---- Check Mapping Expression — returns the SemType of the expression ----
function checkMappingExpr(
  expr: MappingExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  switch (expr.kind) {
    case 'field_access':
      return checkFieldAccess(expr, sourceSchema, env, errors);
    case 'literal':
      return checkLiteral(expr);
    case 'function_call':
      return checkFunctionCall(expr, sourceSchema, env, errors);
    case 'match':
      return checkMatch(expr, sourceSchema, env, errors, warnings);
    case 'pipe':
      return checkPipe(expr, sourceSchema, env, errors, warnings);
    case 'binary':
      return checkBinary(expr, sourceSchema, env, errors, warnings);
    case 'coalesce':
      return checkCoalesce(expr, sourceSchema, env, errors, warnings);
    case 'sub_mapping':
      return checkSubMapping(expr, sourceSchema, env, errors);
    case 'array_literal':
      return checkArrayLiteral(expr, sourceSchema, env, errors, warnings);
  }
}

function checkFieldAccess(
  expr: FieldAccessExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
): SemType {
  let path = expr.path;
  
  // Strip 'source' prefix if present
  if (path.length > 0 && path[0] === 'source') {
    // If path is just ['source'], it's a reference to the whole source record
    if (path.length === 1) {
      return { kind: 'schema', name: sourceSchema.name, fields: sourceSchema.fields };
    }
    path = path.slice(1); // remove 'source' prefix
  }
  let currentType: SemType = { kind: 'schema', name: sourceSchema.name, fields: sourceSchema.fields };

  for (let i = 0; i < path.length; i++) {
    const fieldName = path[i];
    
    if (currentType.kind === 'schema') {
      const field = currentType.fields.get(fieldName);
      if (!field) {
        // If it's a bare identifier (single path element), treat it as a
        // nominal type — could be a variant name or type alias reference
        if (path.length === 1) {
          return { kind: 'nominal', name: fieldName };
        }
        errors.push({
          message: `Field '${fieldName}' does not exist on schema '${currentType.name}'`,
          span: expr.span,
          severity: 'error',
        });
        return { kind: 'error' };
      }
      currentType = field.type;
    } else if (currentType.kind === 'optional') {
      const inner: SemType = currentType.inner;
      if (inner.kind === 'schema') {
        const field: FieldType | undefined = inner.fields.get(fieldName);
        if (!field) {
          if (path.length === 1) {
            return { kind: 'nominal', name: fieldName };
          }
          errors.push({
            message: `Field '${fieldName}' does not exist on schema '${inner.name}'`,
            span: expr.span,
            severity: 'error',
          });
          return { kind: 'error' };
        }
        currentType = field.type;
      } else {
        errors.push({
          message: `Cannot access field '${fieldName}' on non-schema type '${semTypeToString(currentType)}'`,
          span: expr.span,
          severity: 'error',
        });
        return { kind: 'error' };
      }
    } else {
      errors.push({
        message: `Cannot access field '${fieldName}' on type '${semTypeToString(currentType)}'`,
        span: expr.span,
        severity: 'error',
      });
      return { kind: 'error' };
    }
  }

  return currentType;
}

function checkLiteral(expr: LiteralExpr): SemType {
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

function checkFunctionCall(
  expr: FunctionCallExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
): SemType {
  const fn = env.functions.get(expr.name);
  if (!fn) {
    errors.push({
      message: `Function '${expr.name}' is not defined`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }

  // In pipe context, the first arg comes from the pipe — here we check the explicit args
  // For a direct function call, check arg count and types
  if (expr.args.length > fn.paramTypes.length) {
    errors.push({
      message: `Function '${expr.name}' expects at most ${fn.paramTypes.length} arguments, got ${expr.args.length}`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }

  for (let i = 0; i < expr.args.length; i++) {
    const argType = checkMappingExpr(expr.args[i], sourceSchema, env, errors, [] as CheckError[]);
    if (argType.kind !== 'error' && !isTypeCompatible(argType, fn.paramTypes[i], env)) {
      errors.push({
        message: `Argument ${i + 1} of '${expr.name}': expected '${semTypeToString(fn.paramTypes[i])}', got '${semTypeToString(argType)}'`,
        span: expr.span,
        severity: 'error',
      });
    }
  }

  return fn.returnType;
}

function checkMatch(
  expr: MatchExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  const subjectType = checkMappingExpr(expr.subject, sourceSchema, env, errors, warnings);
  if (subjectType.kind === 'error') return { kind: 'error' };

  // Collect all literal values covered
  const coveredValues = new Set<string>();
  let returnType: SemType | null = null;

  for (const arm of expr.arms) {
    if (arm.pattern.kind === 'literal_pattern') {
      coveredValues.add(String(arm.pattern.value));
    } else if (arm.pattern.kind === 'multi_pattern') {
      for (const v of arm.pattern.values) {
        coveredValues.add(String(v));
      }
    }

    const armType = checkMappingExpr(arm.body, sourceSchema, env, errors, warnings);
    if (returnType === null) {
      returnType = armType;
    } else if (!isTypeCompatible(armType, returnType, env)) {
      errors.push({
        message: `Inconsistent return types in match arms: '${semTypeToString(returnType)}' vs '${semTypeToString(armType)}'`,
        span: arm.span,
        severity: 'error',
      });
    }
  }

  // Check default arm
  if (expr.defaultArm) {
    const defType = checkMappingExpr(expr.defaultArm, sourceSchema, env, errors, warnings);
    if (returnType !== null && !isTypeCompatible(defType, returnType, env)) {
      errors.push({
        message: `Default arm return type '${semTypeToString(defType)}' is incompatible with '${semTypeToString(returnType!)}'`,
        span: expr.span,
        severity: 'error',
      });
    }
  }

  // Exhaustiveness check — for union types
  if (subjectType.kind === 'union' && !expr.defaultArm) {
    const allVariants = subjectType.variants
      .filter(v => v.kind === 'nominal')
      .map(v => (v as { kind: 'nominal'; name: string }).name);
    
    for (const variant of allVariants) {
      if (!coveredValues.has(variant)) {
        errors.push({
          message: `Match is not exhaustive: variant '${variant}' is not covered. Add an arm or a default '_' case.`,
          span: expr.span,
          severity: 'error',
        });
      }
    }
  }

  return returnType ?? { kind: 'error' };
}

function checkPipe(
  expr: PipeExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  const leftType = checkMappingExpr(expr.left, sourceSchema, env, errors, warnings);
  if (leftType.kind === 'error') return { kind: 'error' };

  // The right side should be a function_call; the left type becomes its first arg
  if (expr.right.kind !== 'function_call') {
    errors.push({
      message: `Right side of |> must be a function call`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }

  const fn = env.functions.get(expr.right.name);
  if (!fn) {
    errors.push({
      message: `Function '${expr.right.name}' is not defined`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }

  // Check that left type is compatible with the first parameter
  if (fn.paramTypes.length < 1) {
    errors.push({
      message: `Function '${expr.right.name}' takes no parameters, cannot be used in pipe`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }

  if (!isTypeCompatible(leftType, fn.paramTypes[0], env)) {
    errors.push({
      message: `Pipe type mismatch: '${semTypeToString(leftType)}' is not compatible with parameter of '${expr.right.name}' (expected '${semTypeToString(fn.paramTypes[0])}')`,
      span: expr.span,
      severity: 'error',
    });
  }

  // Check remaining args
  for (let i = 0; i < expr.right.args.length; i++) {
    const argType = checkMappingExpr(expr.right.args[i], sourceSchema, env, errors, []);
    const paramIdx = i + 1; // +1 because param 0 is the piped value
    if (paramIdx < fn.paramTypes.length && argType.kind !== 'error') {
      if (!isTypeCompatible(argType, fn.paramTypes[paramIdx], env)) {
        errors.push({
          message: `Argument ${i + 1} of '${expr.right.name}': type mismatch`,
          span: expr.span,
          severity: 'error',
        });
      }
    }
  }

  return fn.returnType;
}

function checkBinary(
  expr: BinaryExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  const leftType = checkMappingExpr(expr.left, sourceSchema, env, errors, warnings);
  const rightType = checkMappingExpr(expr.right, sourceSchema, env, errors, warnings);

  if (expr.operator === '+') {
    // String concatenation or numeric addition
    if (leftType.kind === 'primitive' && leftType.name === 'String' &&
        rightType.kind === 'primitive' && rightType.name === 'String') {
      return { kind: 'primitive', name: 'String' };
    }
    if (leftType.kind === 'primitive' && rightType.kind === 'primitive' &&
        (leftType.name === 'Int' || leftType.name === 'Float') &&
        (rightType.name === 'Int' || rightType.name === 'Float')) {
      return leftType.name === 'Float' || rightType.name === 'Float'
        ? { kind: 'primitive', name: 'Float' }
        : { kind: 'primitive', name: 'Int' };
    }
    errors.push({
      message: `Operator '+' requires String + String or numeric + numeric, got '${semTypeToString(leftType)}' + '${semTypeToString(rightType)}'`,
      span: expr.span,
      severity: 'error',
    });
  }

  return { kind: 'error' };
}

function checkCoalesce(
  expr: CoalesceExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  const innerType = checkMappingExpr(expr.expr, sourceSchema, env, errors, warnings);
  // The ? operator just propagates optionality — it doesn't change the actual type
  // In a more complete implementation, this would wrap the type in Optional
  return innerType;
}

function checkSubMapping(
  expr: SubMappingExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
): SemType {
  const mappingInfo = env.mappings.get(expr.mappingName);
  if (!mappingInfo) {
    errors.push({
      message: `Sub-mapping '${expr.mappingName}' is not defined`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }
  
  const targetSchema = env.schemas.get(mappingInfo.target);
  if (!targetSchema) {
    errors.push({
      message: `Target schema '${mappingInfo.target}' for mapping '${expr.mappingName}' not found`,
      span: expr.span,
      severity: 'error',
    });
    return { kind: 'error' };
  }
  
  return { kind: 'schema', name: mappingInfo.target, fields: targetSchema.fields };
}

function checkArrayLiteral(
  expr: ArrayLiteralExpr,
  sourceSchema: SchemaType,
  env: TypeEnv,
  errors: CheckError[],
  warnings: CheckError[],
): SemType {
  if (expr.elements.length === 0) {
    return { kind: 'array', inner: { kind: 'primitive', name: 'String' } };
  }

  let elementType: SemType | null = null;
  let hasCoalesce = false;
  for (const elem of expr.elements) {
    if (elem.kind === 'coalesce') {
      hasCoalesce = true;
    }
    const elemType = checkMappingExpr(elem, sourceSchema, env, errors, warnings);
    if (elementType === null) {
      elementType = elemType;
    } else if (!isTypeCompatible(elemType, elementType, env)) {
      errors.push({
        message: `Inconsistent array element types: '${semTypeToString(elementType)}' vs '${semTypeToString(elemType)}'`,
        span: expr.span,
        severity: 'error',
      });
    }
  }

  let finalType = elementType ?? { kind: 'primitive', name: 'String' };
  if (hasCoalesce && finalType.kind !== 'optional') {
    finalType = { kind: 'optional', inner: finalType };
  }
  return { kind: 'array', inner: finalType };
}

// ---- Type Compatibility ----
function isTypeCompatible(from: SemType, to: SemType, env: TypeEnv): boolean {
  // Same type
  if (from.kind === to.kind) {
    switch (from.kind) {
      case 'primitive': {
        const f = from as { kind: 'primitive'; name: string };
        const t = to as { kind: 'primitive'; name: string };
        // Primitive widening: any number -> Decimal, any -> String
        if (t.name === 'String') return true;  // any primitive can become string
        if (t.name === 'Decimal' && (f.name === 'Int' || f.name === 'Float')) return true;
        return f.name === t.name;
      }
      case 'nominal':
        // Nominal types need special handling — skip strict name check,
        // handled below with alias resolution
        return true;  // different nominals are compatible (union variants)
      case 'optional':
        return isTypeCompatible(from.inner, (to as typeof from).inner, env);
      case 'array':
        return isTypeCompatible(from.inner, (to as typeof from).inner, env);
      case 'schema':
        return from.name === (to as typeof from).name;
      case 'union':
        // All variants of 'from' must be compatible with 'to' union
        return from.variants.every(v =>
          (to as typeof from).variants.some(tv => isTypeCompatible(v, tv, env))
        );
      case 'refined':
        return isTypeCompatible(from.base, (to as typeof from).base, env);
      case 'error':
        return true; // suppress further errors
    }
  }

  // Optional compatibility: unwrap both sides
  if (from.kind === 'optional' && to.kind === 'optional') {
    return isTypeCompatible(from.inner, to.inner, env);
  }

  // X is compatible with X? (non-null to optional)
  if (to.kind === 'optional') {
    return isTypeCompatible(from, to.inner, env);
  }

  // X? is compatible with X if X allows null (for pragmatic integration)
  if (from.kind === 'optional') {
    return isTypeCompatible(from.inner, to, env);
  }

  // Refined type is compatible with its base, and vice versa
  if (from.kind === 'refined' && isTypeCompatible(from.base, to, env)) {
    return true;
  }
  if (to.kind === 'refined' && isTypeCompatible(from, to.base, env)) {
    return true;
  }

  // Nominal types are compatible with each other (variants of same union)
  if (from.kind === 'nominal' && to.kind === 'nominal') {
    return true;
  }

  // Nominal -> resolved base (e.g. Email -> String)
  if (from.kind === 'nominal') {
    const alias = env.typeAliases.get(from.name);
    if (alias && isTypeCompatible(alias.semType, to, env)) {
      return true;
    }
  }

  // Resolved base -> Nominal (e.g. String -> Email if Email refines String)
  if (to.kind === 'nominal') {
    const alias = env.typeAliases.get(to.name);
    if (alias && isTypeCompatible(from, alias.semType, env)) {
      return true;
    }
  }

  // Nominal is compatible with schema of same name
  if (to.kind === 'nominal' && from.kind === 'schema' && from.name === to.name) {
    return true;
  }
  if (from.kind === 'nominal' && to.kind === 'schema' && from.name === to.name) {
    return true;
  }

  // Nominal is compatible with union (variant belongs to union)
  if (from.kind === 'nominal' && to.kind === 'union') {
    return true;
  }

  // String is compatible with string-literal union types
  // (common in data integration: source has raw string, target has enum)
  if (from.kind === 'primitive' && from.name === 'String' && to.kind === 'union') {
    return true;
  }

  // Any primitive is compatible with String (for to_string and similar)
  if (from.kind === 'primitive' && to.kind === 'primitive' && to.name === 'String') {
    return true;
  }

  // Int/Float are compatible with Decimal
  if (from.kind === 'primitive' && (from.name === 'Int' || from.name === 'Float') &&
      to.kind === 'primitive' && to.name === 'Decimal') {
    return true;
  }

  return false;
}

function hasAnnotation(field: FieldType, name: string): boolean {
  return field.annotations.some(a => a.name === name);
}
