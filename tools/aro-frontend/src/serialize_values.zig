const std = @import("std");
const aro = @import("aro");
const serialize_types = @import("serialize_types.zig");

pub const SymbolResolver = struct {
    context: *const anyopaque,
    resolve: *const fn (context: *const anyopaque, node: u32) ?u32,

    pub fn idForNode(resolver: SymbolResolver, node: u32) ?u32 {
        return resolver.resolve(resolver.context, node);
    }
};

pub fn writeConstant(
    output: anytype,
    value: aro.Value,
    destination_qt: aro.QualType,
    types: *serialize_types.Store,
    symbols: SymbolResolver,
    origin_node: ?aro.Tree.Node.Index,
) !void {
    const comp = types.tree.comp;
    if (origin_node) |node| {
        if (destination_qt.get(comp, .float) != null and value.isZero(comp) and isNegativeFloatingZero(types.tree, node)) {
            try output.add("{\"kind\":\"floating\",\"type\":");
            try output.integer(try types.intern(destination_qt));
            try output.add(",\"ieeeBits\":");
            try output.string(switch (destination_qt.bitSizeof(comp)) {
                32 => "80000000",
                64 => "8000000000000000",
                else => return error.UnsupportedValue,
            });
            try output.byte('}');
            return;
        }
    }
    switch (comp.interner.get(value.ref())) {
        .int => {
            const is_pointer = destination_qt.is(comp, .pointer);
            if (is_pointer and !value.isZero(comp)) return error.UnsupportedValue;
            try output.add("{\"kind\":\"integer\",\"bits\":");
            try output.integer(if (is_pointer) 32 else destination_qt.bitSizeof(comp));
            try output.add(",\"signed\":");
            try output.add(if (!is_pointer and destination_qt.signedness(comp) == .signed) "true" else "false");
            try output.add(",\"value\":");
            try types.writeIntegerText(output, value, if (is_pointer) aro.QualType.uint else destination_qt);
            try output.byte('}');
        },
        .float => |floating| {
            try output.add("{\"kind\":\"floating\",\"type\":");
            try output.integer(try types.intern(destination_qt));
            try output.add(",\"ieeeBits\":");
            try writeFloatBits(output, floating);
            try output.byte('}');
        },
        .bytes => |bytes| {
            if (destination_qt.get(comp, .array)) |array| {
                try output.add("{\"kind\":\"string\",\"elementType\":");
                try output.integer(try types.intern(array.elem));
                try output.add(",\"bytes\":[");
                for (bytes, 0..) |byte, index| {
                    if (index != 0) try output.byte(',');
                    try output.integer(byte);
                }
                try output.add("]}");
            } else if (destination_qt.is(comp, .pointer)) {
                const node = origin_node orelse return error.MissingSymbol;
                const symbol = symbols.idForNode(@backingInt(node)) orelse return error.MissingSymbol;
                try output.add("{\"kind\":\"address\",\"symbol\":");
                try output.integer(symbol);
                try output.add(",\"addend\":\"0\"}");
            } else {
                return error.UnsupportedValue;
            }
        },
        .pointer => |pointer| {
            const symbol = symbols.idForNode(pointer.node) orelse return error.MissingSymbol;
            try output.add("{\"kind\":\"address\",\"symbol\":");
            try output.integer(symbol);
            try output.add(",\"addend\":");
            try types.writeIntegerText(output, aro.Value.fromRef(pointer.offset), comp.type_store.ptrdiff);
            try output.byte('}');
        },
        .null => {
            try output.add("{\"kind\":\"integer\",\"bits\":32,\"signed\":false,\"value\":\"0\"}");
        },
        else => return error.UnsupportedValue,
    }
}

pub fn isNegativeFloatingZero(tree: *const aro.Tree, node: aro.Tree.Node.Index) bool {
    return floatingZeroSign(tree, node) orelse false;
}

fn floatingZeroSign(tree: *const aro.Tree, node: aro.Tree.Node.Index) ?bool {
    return switch (node.get(tree)) {
        .float_literal => blk: {
            const value = tree.value_map.get(node) orelse break :blk null;
            break :blk if (value.isZero(tree.comp)) false else null;
        },
        .negate_expr => |unary| if (floatingZeroSign(tree, unary.operand)) |negative| !negative else null,
        .plus_expr, .paren_expr => |unary| floatingZeroSign(tree, unary.operand),
        .cast => |cast| switch (cast.kind) {
            .no_op, .float_cast => floatingZeroSign(tree, cast.operand),
            else => null,
        },
        else => null,
    };
}

fn writeFloatBits(output: anytype, floating: anytype) !void {
    var buffer: [32]u8 = undefined;
    const text = switch (floating) {
        .f16 => |value| try std.fmt.bufPrint(&buffer, "{x:0>4}", .{@as(u16, @bitCast(value))}),
        .f32 => |value| try std.fmt.bufPrint(&buffer, "{x:0>8}", .{@as(u32, @bitCast(value))}),
        .f64 => |value| try std.fmt.bufPrint(&buffer, "{x:0>16}", .{@as(u64, @bitCast(value))}),
        .f80 => |value| try std.fmt.bufPrint(&buffer, "{x:0>20}", .{@as(u80, @bitCast(value))}),
        .f128 => |value| try std.fmt.bufPrint(&buffer, "{x:0>32}", .{@as(u128, @bitCast(value))}),
    };
    try output.string(text);
}
