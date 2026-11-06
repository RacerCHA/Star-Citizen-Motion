// SPDX-License-Identifier: GPL-3.0-or-later
export function varint(value) {
  let n = BigInt.asUintN(64, BigInt(value)); const bytes = [];
  do { const x = Number(n & 127n); n >>= 7n; bytes.push(x | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
export function encodeMessage(obj, name, schema) {
  const chunks = [];
  for (const f of schema.messages[name]) {
    if (!(f.name in obj)) continue;
    const values = f.label === 3 ? obj[f.name] : [obj[f.name]];
    for (const v of values) {
      let wire, body;
      if (f.type === 1 || f.type === 2) {
        wire = f.type === 1 ? 1 : 5; body = Buffer.alloc(f.type === 1 ? 8 : 4);
        if (f.type === 1) body.writeDoubleLE(v); else body.writeFloatLE(v);
      } else if ([9,11,12].includes(f.type)) {
        wire = 2; body = f.type === 11 ? encodeMessage(v,f.type_name,schema) : f.type === 12 ? Buffer.from(v,'base64') : Buffer.from(v,'utf8');
        body = Buffer.concat([varint(body.length),body]);
      } else { wire = 0; body = varint(f.type === 8 ? Number(v) : v); }
      chunks.push(varint((f.number << 3) | wire),body);
    }
  }
  return Buffer.concat(chunks);
}
export function frame(body) {
  const head = Buffer.alloc(5); head.writeUInt32BE(body.length,1);
  return Buffer.concat([head,body]);
}
