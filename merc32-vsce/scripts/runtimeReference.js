function add64(aLo, aHi, bLo, bHi) { const value = (BigInt(aLo >>> 0) | (BigInt(aHi >>> 0) << 32n)) + (BigInt(bLo >>> 0) | (BigInt(bHi >>> 0) << 32n)); return { lo: Number(value & 0xffffffffn) >>> 0, hi: Number((value >> 32n) & 0xffffffffn) >>> 0 }; }
function sub64(aLo, aHi, bLo, bHi) { const value = (BigInt(aLo >>> 0) | (BigInt(aHi >>> 0) << 32n)) - (BigInt(bLo >>> 0) | (BigInt(bHi >>> 0) << 32n)); return { lo: Number(value & 0xffffffffn) >>> 0, hi: Number((value >> 32n) & 0xffffffffn) >>> 0 }; }
module.exports = { add64, sub64 };
