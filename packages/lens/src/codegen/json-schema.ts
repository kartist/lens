// ============================================================
// JSON Schema Code Generator — compiles Lens IR to JSON Schema
// ============================================================

import { IRDocument, IRSchema, IRSchemaField, IRAnnotation, IResolvedType } from '../ir';

export function generateJsonSchemas(ir: IRDocument): Record<string, object> {
  const schemas: Record<string, object> = {};

  for (const schema of ir.schemas) {
    schemas[schema.name] = generateJsonSchema(schema);
  }

  return schemas;
}

function generateJsonSchema(schema: IRSchema): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    const fieldSchema = irTypeToJsonSchema(field.type);

    // Apply annotations
    let finalFieldSchema = fieldSchema;
    for (const ann of field.annotations) {
      finalFieldSchema = applyAnnotation(finalFieldSchema, ann);
    }

    // Check if required
    const isOptional = field.type.kind === 'optional' ||
      field.annotations.some((a: IRAnnotation) => a.name === 'auto' || a.name === 'audit');

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

function irTypeToJsonSchema(t: IResolvedType): object {
  switch (t.kind) {
    case 'primitive':
      return primitiveToJsonSchema(t.name);
    case 'nominal':
      // Nominal types are treated as strings with optional format
      return { type: 'string' };
    case 'optional':
      return irTypeToJsonSchema(t.inner);
    case 'array':
      return {
        type: 'array',
        items: irTypeToJsonSchema(t.inner),
      };
    case 'union':
      return {
        anyOf: t.variants.map((v: IResolvedType) => irTypeToJsonSchema(v)),
      };
    case 'refined':
      return applyRefinement(irTypeToJsonSchema(t.base), t.constraint);
    case 'schema_ref':
      return { $ref: `#/definitions/${t.name}` };
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
  return {
    ...schema,
    pattern: constraint,
  };
}

function applyAnnotation(schema: object, ann: IRAnnotation): object {
  switch (ann.name) {
    case 'max': {
      const val = ann.args[0];
      if (typeof val === 'number') {
        return { ...schema, maximum: val };
      }
      break;
    }
    case 'min': {
      const val = ann.args[0];
      if (typeof val === 'number') {
        return { ...schema, minimum: val };
      }
      break;
    }
    case 'min_length': {
      const val = ann.args[0];
      if (typeof val === 'number') {
        return { ...schema, minItems: val };
      }
      break;
    }
    case 'max_length': {
      const val = ann.args[0];
      if (typeof val === 'number') {
        return { ...schema, maxItems: val };
      }
      break;
    }
    case 'required':
    case 'id':
    case 'auto':
    case 'immutable':
    case 'audit':
    case 'references':
      // Handled at field level or Lens-specific
      break;
  }
  return schema;
}
