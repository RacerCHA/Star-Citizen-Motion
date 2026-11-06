// Descriptor-driven protobuf decoder. No game code is loaded into this process.
export function decodeMessage(buffer, name, schema, depth = 0) {
  if (depth > 32) throw new Error('Message nesting limit exceeded');
  const fields = schema.messages[name];
  if (!fields) throw new Error(`Unknown message ${name}`);
  const byNumber = new Map(fields.map(f => [f.number, f]));
  const out = {};
  // Protobuf scalar defaults apply only inside a message actually received.
  for (const f of fields) {
    if (f.label === 3) out[f.name] = [];
    else if (f.type !== 11 && !f.proto3_optional && f.oneof_index == null)
      out[f.name] = [9, 12].includes(f.type) ? '' : f.type === 8 ? false : [3, 4, 6, 16, 18].includes(f.type) ? '0' : 0;
  }
  let p = 0;
  function need(n) { if (p + n > buffer.length) throw new Error('Truncated protobuf field'); }
  function varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      need(1); const b = buffer[p++];
      if (i === 9 && b > 1) throw new Error('Invalid varint');
      value |= BigInt(b & 127) << BigInt(i * 7);
      if (!(b & 128)) return value;
    }
    throw new Error('Invalid varint');
  }
  while (p < buffer.length) {
    const start = p, tag = Number(varint()), number = tag >>> 3, wire = tag & 7;
    if (!number) throw new Error('Invalid protobuf tag');
    let raw;
    if (wire === 0) raw = varint();
    else if (wire === 1 || wire === 5) { const n = wire === 1 ? 8 : 4; need(n); raw = buffer.subarray(p, p += n); }
    else if (wire === 2) { const n = Number(varint()); need(n); raw = buffer.subarray(p, p += n); }
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
    const f = byNumber.get(number);
    if (!f) continue; // Discard unrecognized fields, including unused initialization credentials.
    const expected = f.type === 1 || [6,16].includes(f.type) ? 1 : [2,7,15].includes(f.type) ? 5 : [9,11,12].includes(f.type) ? 2 : 0;
    if (wire !== expected) throw new Error(`Unexpected wire type for ${name}.${f.name}: ${wire}`);
    let value;
    switch (f.type) {
      case 1: value = raw.readDoubleLE(); break;
      case 2: value = raw.readFloatLE(); break;
      case 3: value = BigInt.asIntN(64,raw).toString(); break;
      case 4: value = raw.toString(); break;
      case 5: case 14: value = Number(BigInt.asIntN(32,raw)); break;
      case 6: value = raw.readBigUInt64LE().toString(); break;
      case 7: value = raw.readUInt32LE(); break;
      case 8: value = raw !== 0n; break;
      case 9: value = raw.toString('utf8'); break;
      case 11: value = decodeMessage(raw, f.type_name, schema, depth + 1); break;
      case 12: value = raw.toString('base64'); break;
      case 13: value = Number(BigInt.asUintN(32,raw)); break;
      case 15: value = raw.readInt32LE(); break;
      case 16: value = raw.readBigInt64LE().toString(); break;
      case 17: value = Number((raw >> 1n) ^ -(raw & 1n)); break;
      case 18: value = ((raw >> 1n) ^ -(raw & 1n)).toString(); break;
      default: throw new Error(`Unsupported protobuf type ${f.type}`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) value = String(value);
    if (f.label === 3) out[f.name].push(value);
    else {
      if (f.oneof_index != null) for (const other of fields)
        if (other.number !== f.number && other.oneof_index === f.oneof_index) delete out[other.name];
      out[f.name] = value;
    }
  }
  return out;
}

export class GrpcFrames {
  constructor(onMessage, maxBytes = 8 * 1024 * 1024) { this.pending = Buffer.alloc(0); this.onMessage = onMessage; this.maxBytes = maxBytes; }
  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 5) {
      const compression = this.pending[0], size = this.pending.readUInt32BE(1);
      if (compression !== 0) throw new Error('Compressed gRPC messages are not supported');
      if (size > this.maxBytes) throw new Error('gRPC message exceeds size limit');
      if (this.pending.length < size + 5) return;
      const body = this.pending.subarray(5, 5 + size);
      this.pending = this.pending.subarray(5 + size);
      this.onMessage(body);
    }
  }
  finish() { if (this.pending.length) throw new Error('Truncated gRPC stream'); }
}
