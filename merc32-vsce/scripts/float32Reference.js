function bits(value) { const buffer = new ArrayBuffer(4); new DataView(buffer).setFloat32(0, value, true); return new DataView(buffer).getUint32(0, true); }
function value(word) { const buffer = new ArrayBuffer(4); new DataView(buffer).setUint32(0, word >>> 0, true); return new DataView(buffer).getFloat32(0, true); }
function binary(op, a, b) { const av = value(a), bv = value(b); return bits(op === 'add' ? av + bv : op === 'sub' ? av - bv : op === 'mul' ? av * bv : av / bv); }
module.exports = { bits, value, binary };
