// ============================================================
// JSON Schema Code Generator
// ============================================================

import { Document, SchemaDecl, TypeAliasDecl, TypeExpr, Annotation } from '../parser/ast';

export function generateJsonSchemas(document: Document): Record<string, object> {
  const schemas: Record<string, object> = {};

  // Separate schema declarations
  for (const decl of document.declarations) {
    if (decl.kind === 'schema_decl') {
      schemas[decl.name] = generateJsonSchema(decl);
    }
  }

  return schemas;
}

function generateJsonSchema(schema: SchemaDecl): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    const fieldSchema = typeExprToJsonSchema(field.type);

    // Apply annotations
    let finalFieldSchema = fieldSchema;
    for (const ann of field.annotations) {
      finalFieldSchema = applyAnnotation(finalFieldSchema, ann);
    }

    // Check if required
    const isOptional = field.type.kind === 'optional' ||
      field.annotations.some(a => a.name === 'auto' || a.name === 'audit');

    properties[field.name] = finalFieldSchema;
    if (!isOptional) {
      required.push(field.name);
    }
  }

  const result: any = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: schema.name,
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}

function typeExprToJsonSchema(type: TypeExpr): object {
  switch (type.kind) {
    case 'primitive':
      return primitiveToJsonSchema(type.name);
    case 'nominal':
      // Nominal types are treated as strings with optional format
      return { type: 'string' };
    case 'optional':
      return typeExprToJsonSchema(type.inner); // optional handled at field level
    case 'array':
      return {
        type: 'array',
        items: typeExprToJsonSchema(type.inner),
      };
    case 'union':
      return {
        anyOf: type.variants.map(v => typeExprToJsonSchema(v)),
      };
    case 'refined':
      return applyRefinement(typeExprToJsonSchema(type.base), type.constraint);
    case 'schema_ref':
      return { $ref: `#/definitions/${type.name}` };
  }
}

function primitiveToJsonSchema(name: string): object {
  switch (name) {
    case 'String':
      return { type: 'string' };
    case 'Int':
      return { type: 'integer' };
    case 'Float':
    case 'Decimal':
      return { type: 'number' };
    case 'Bool':
      return { type: 'boolean' };
    case 'DateTime':
      return { type: 'string', format: 'date-time' };
    case 'Uuid':
      return { type: 'string', format: 'uuid' };
    case 'Json':
      return { type: 'object' };
    default:
      return { type: 'string' };
  }
}

function applyRefinement(schema: object, constraint: string): object {
  // A refined type like /pattern/ adds a regex pattern
  return {
    ...schema,
    pattern: constraint,
  };
}

function applyAnnotation(schema: object, ann: Annotation): object {
  switch (ann.name) {
    case 'max': {
      const val = ann.args[0];
      if (val && val.kind === 'arg_number') {
        return { ...schema, maximum: val.value };
      }
      break;
    }
    case 'min': {
      const val = ann.args[0];
      if (val && val.kind === 'arg_number') {
        return { ...schema, minimum: val.value };
      }
      break;
    }
    case 'min_length': {
      const val = ann.args[0];
      if (val && val.kind === 'arg_number') {
        return { ...schema, minItems: val.value };
      }
      break;
    }
    case 'max_length': {
      const val = ann.args[0];
      if (val && val.kind === 'arg_number') {
        return { ...schema, maxItems: val.value };
      }
      break;
    }
    case 'required':
      // Already handled at field level
      break;
    case 'id':
    case 'auto':
    case 'immutable':
    case 'audit':
    case 'references':
      // These are Lens-specific — not directly representable in JSON Schema
      break;
  }
  return schema;
}
