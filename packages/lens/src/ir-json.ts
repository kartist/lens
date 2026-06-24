// ============================================================
// JSON IR Serialization — serialize/deserialize IR to/from JSON
// ============================================================

import { IRDocument } from './ir';

/**
 * Serialize an IRDocument to a JSON string.
 * The IR is already JSON-compatible — no special handling needed.
 */
export function serializeIR(ir: IRDocument): string {
  return JSON.stringify(ir, null, 2);
}

/**
 * Deserialize a JSON string back to an IRDocument.
 */
export function deserializeIR(json: string): IRDocument {
  return JSON.parse(json) as IRDocument;
}
