const aro = @import("aro");
const serialize_types = @import("serialize_types.zig");
const serialize_values = @import("serialize_values.zig");

pub fn write(
    output: anytype,
    node: ?aro.Tree.Node.Index,
    qt: aro.QualType,
    types: *serialize_types.Store,
    symbols: serialize_values.SymbolResolver,
) !void {
    try output.add("{\"size\":");
    try output.integer(qt.sizeof(types.tree.comp));
    try output.add(",\"zeroFill\":true,\"writes\":[");
    var state = State(@TypeOf(output)){
        .output = output,
        .types = types,
        .symbols = symbols,
    };
    if (node) |initializer| try state.walk(initializer, qt, 0);
    try output.add("]}");
}

fn State(comptime Output: type) type {
    return struct {
        output: Output,
        types: *serialize_types.Store,
        symbols: serialize_values.SymbolResolver,
        needs_comma: bool = false,

        const Self = @This();

        fn walk(self: *Self, node_index: aro.Tree.Node.Index, destination_qt: aro.QualType, offset: u64) !void {
            const tree = self.types.tree;
            const comp = tree.comp;
            if (destination_qt.is(comp, .pointer)) if (self.symbols.idForNode(@backingInt(node_index))) |symbol| {
                if (self.needs_comma) try self.output.byte(',');
                self.needs_comma = true;
                try self.output.add("{\"offset\":");
                try self.output.integer(offset);
                try self.output.add(",\"type\":");
                try self.output.integer(try self.types.intern(destination_qt));
                try self.output.add(",\"value\":{\"kind\":\"address\",\"symbol\":");
                try self.output.integer(symbol);
                try self.output.add(",\"addend\":\"0\"}}");
                return;
            };
            switch (node_index.get(tree)) {
                .compound_literal_expr => |literal| try self.walk(literal.initializer, destination_qt, offset),
                .paren_expr => |paren| {
                    if (tree.value_map.get(node_index)) |value| {
                        if (!isZeroFillValue(value, destination_qt, tree, node_index)) try self.emit(node_index, offset, destination_qt, value);
                    } else {
                        try self.walk(paren.operand, destination_qt, offset);
                    }
                },
                .default_init_expr, .array_filler_expr => {},
                .array_init_expr => |initializer| {
                    const array = destination_qt.get(comp, .array) orelse return error.UnsupportedInitializer;
                    const element_size = array.elem.sizeof(comp);
                    var element_index: u64 = 0;
                    for (initializer.items) |item| switch (item.get(tree)) {
                        .array_filler_expr => |filler| element_index += filler.count,
                        else => {
                            try self.walk(item, array.elem, offset + element_index * element_size);
                            element_index += 1;
                        },
                    };
                },
                .struct_init_expr => |initializer| {
                    const record = destination_qt.get(comp, .@"struct") orelse return error.UnsupportedInitializer;
                    if (initializer.items.len != record.fields.len) return error.UnsupportedInitializer;
                    for (initializer.items, record.fields) |item, field| {
                        if (field.bit_width.unpack() != null) {
                            if (item.get(tree) == .default_init_expr) continue;
                            const value = tree.value_map.get(item) orelse return error.UnsupportedInitializer;
                            if (value.isZero(comp)) continue;
                            return error.UnsupportedInitializer;
                        }
                        try self.walk(item, field.qt, offset + @divExact(field.layout.offset_bits, 8));
                    }
                },
                .union_init_expr => |initializer| {
                    const record = destination_qt.get(comp, .@"union") orelse return error.UnsupportedInitializer;
                    if (initializer.initializer) |item| {
                        if (initializer.field_index >= record.fields.len) return error.UnsupportedInitializer;
                        const field = record.fields[initializer.field_index];
                        if (field.bit_width.unpack() != null) return error.UnsupportedInitializer;
                        try self.walk(item, field.qt, offset + @divExact(field.layout.offset_bits, 8));
                    }
                },
                .string_literal_expr => {
                    const value = tree.value_map.get(node_index) orelse return error.UnsupportedValue;
                    try self.emit(node_index, offset, destination_qt, value);
                },
                .cast => |cast| {
                    if (tree.value_map.get(node_index)) |value| {
                        if (!isZeroFillValue(value, destination_qt, tree, node_index)) try self.emit(node_index, offset, destination_qt, value);
                    } else if (destination_qt.is(comp, .pointer)) {
                        if (cast.kind == .lval_to_rval) return self.walk(cast.operand, destination_qt, offset);
                        const operand = tree.value_map.get(cast.operand) orelse return error.UnsupportedValue;
                        if (!operand.isZero(comp)) return error.UnsupportedValue;
                    } else if (cast.kind == .no_op or destination_qt.is(comp, .@"struct") or destination_qt.is(comp, .@"union")) {
                        try self.walk(cast.operand, destination_qt, offset);
                    } else {
                        return error.UnsupportedValue;
                    }
                },
                else => {
                    const value = tree.value_map.get(node_index) orelse return error.UnsupportedValue;
                    if (isZeroFillValue(value, destination_qt, tree, node_index)) return;
                    try self.emit(node_index, offset, destination_qt, value);
                },
            }
        }

        fn emit(self: *Self, node: aro.Tree.Node.Index, offset: u64, qt: aro.QualType, value: aro.Value) !void {
            if (self.needs_comma) try self.output.byte(',');
            self.needs_comma = true;
            try self.output.add("{\"offset\":");
            try self.output.integer(offset);
            try self.output.add(",\"type\":");
            try self.output.integer(try self.types.intern(qt));
            try self.output.add(",\"value\":");
            try serialize_values.writeConstant(self.output, value, qt, self.types, self.symbols, node);
            try self.output.byte('}');
        }
    };
}

fn isZeroFillValue(
    value: aro.Value,
    destination_qt: aro.QualType,
    tree: *const aro.Tree,
    node: aro.Tree.Node.Index,
) bool {
    if (destination_qt.get(tree.comp, .float) != null and serialize_values.isNegativeFloatingZero(tree, node)) return false;
    return switch (tree.comp.interner.get(value.ref())) {
        .int, .null => value.isZero(tree.comp),
        else => false,
    };
}
