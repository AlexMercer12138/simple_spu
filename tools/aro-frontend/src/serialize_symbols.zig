const std = @import("std");
const aro = @import("aro");
const serialize_initializers = @import("serialize_initializers.zig");
const serialize_types = @import("serialize_types.zig");
const serialize_values = @import("serialize_values.zig");

pub const Store = struct {
    allocator: std.mem.Allocator,
    tree: *const aro.Tree,
    types: *serialize_types.Store,
    records: std.ArrayList(Record) = .empty,
    by_node: std.AutoHashMapUnmanaged(aro.Tree.Node.Index, u32) = .empty,

    const Kind = enum {
        variable,
        function,
        parameter,
        typedef,
        record,
        @"enum",
        enumerator,
        string_literal,
    };

    const Record = struct {
        kind: Kind,
        node: aro.Tree.Node.Index,
        owner: u32 = 0,
        type_qt: aro.QualType = .invalid,
    };

    pub fn init(allocator: std.mem.Allocator, tree: *const aro.Tree, types: *serialize_types.Store) Store {
        return .{ .allocator = allocator, .tree = tree, .types = types };
    }

    pub fn deinit(store: *Store) void {
        store.records.deinit(store.allocator);
        store.by_node.deinit(store.allocator);
    }

    pub fn collect(store: *Store) !void {
        for (store.tree.root_decls.items) |node_index| {
            switch (node_index.get(store.tree)) {
                .variable => |decl| if (!decl.implicit and store.types.isSourceToken(decl.name_tok)) {
                    const owner = try store.add(.variable, node_index, decl.qt, 0, decl.definition);
                    if (decl.qt.get(store.tree.comp, .pointer) != null) {
                        if (decl.initializer) |initializer| _ = try store.collectStringLiteral(initializer, owner);
                    }
                },
                .function => |decl| if (store.types.isSourceToken(decl.name_tok)) {
                    const owner = try store.add(.function, node_index, decl.qt, 0, decl.definition);
                    const function = decl.qt.get(store.tree.comp, .func) orelse return error.UnsupportedType;
                    for (function.params) |param| if (param.node.unpack()) |param_node| {
                        _ = try store.add(.parameter, param_node, param.qt, owner, null);
                    };
                },
                .typedef => |decl| if (!decl.implicit and store.types.isSourceToken(decl.name_tok)) {
                    const type_id = try store.types.internTypedef(node_index, store.tree.tokSlice(decl.name_tok), decl.qt);
                    _ = type_id;
                    _ = try store.add(.typedef, node_index, decl.qt, 0, null);
                },
                .struct_decl, .union_decl => |decl| if (store.types.isSourceToken(decl.name_or_kind_tok)) {
                    _ = try store.add(.record, node_index, decl.container_qt, 0, null);
                },
                .struct_forward_decl, .union_forward_decl => |decl| if (store.types.isSourceToken(decl.name_or_kind_tok)) {
                    _ = try store.add(.record, node_index, decl.container_qt, 0, decl.definition);
                },
                .enum_decl => |decl| if (store.types.isSourceToken(decl.name_or_kind_tok)) {
                    const owner = try store.add(.@"enum", node_index, decl.container_qt, 0, null);
                    for (decl.fields) |field_node| {
                        _ = try store.add(.enumerator, field_node, decl.container_qt, owner, null);
                    }
                },
                .enum_forward_decl => |decl| if (store.types.isSourceToken(decl.name_or_kind_tok)) {
                    _ = try store.add(.@"enum", node_index, decl.container_qt, 0, decl.definition);
                },
                else => {},
            }
        }
    }

    fn add(
        store: *Store,
        kind: Kind,
        node: aro.Tree.Node.Index,
        type_qt: aro.QualType,
        owner: u32,
        definition: ?aro.Tree.Node.Index,
    ) !u32 {
        if (store.by_node.get(node)) |id| return id;
        if (definition) |definition_node| if (store.by_node.get(definition_node)) |id| {
            try store.by_node.put(store.allocator, node, id);
            return id;
        };
        const id: u32 = @intCast(store.records.items.len + 1);
        try store.records.append(store.allocator, .{
            .kind = kind,
            .node = node,
            .owner = owner,
            .type_qt = type_qt,
        });
        try store.by_node.put(store.allocator, node, id);
        if (definition) |definition_node| try store.by_node.put(store.allocator, definition_node, id);
        return id;
    }

    fn collectStringLiteral(store: *Store, node: aro.Tree.Node.Index, owner: u32) !?u32 {
        if (store.by_node.get(node)) |id| return id;
        return switch (node.get(store.tree)) {
            .string_literal_expr => |literal| blk: {
                const id = try store.add(.string_literal, node, literal.qt, owner, null);
                _ = try store.types.intern(literal.qt);
                break :blk id;
            },
            .cast => |cast| if (try store.collectStringLiteral(cast.operand, owner)) |id| blk: {
                try store.by_node.put(store.allocator, node, id);
                break :blk id;
            } else null,
            .paren_expr => |paren| if (try store.collectStringLiteral(paren.operand, owner)) |id| blk: {
                try store.by_node.put(store.allocator, node, id);
                break :blk id;
            } else null,
            else => null,
        };
    }

    pub fn resolver(store: *const Store) serialize_values.SymbolResolver {
        return .{ .context = store, .resolve = resolveNode };
    }

    pub fn write(store: *Store, output: anytype) !void {
        try output.byte('[');
        for (store.records.items, 0..) |record, index| {
            if (index != 0) try output.byte(',');
            try store.writeRecord(output, @intCast(index + 1), record);
        }
        try output.byte(']');
    }

    fn writeRecord(store: *Store, output: anytype, id: u32, record: Record) !void {
        const node = record.node.get(store.tree);
        const name_token: aro.Tree.TokenIndex = switch (node) {
            .variable => |decl| decl.name_tok,
            .function => |decl| decl.name_tok,
            .param => |decl| decl.name_tok,
            .typedef => |decl| decl.name_tok,
            .struct_decl, .union_decl, .enum_decl => |decl| decl.name_or_kind_tok,
            .struct_forward_decl, .union_forward_decl, .enum_forward_decl => |decl| decl.name_or_kind_tok,
            .enum_field => |field| field.name_tok,
            .string_literal_expr => |literal| literal.literal_tok,
            else => return error.UnsupportedSymbol,
        };
        try output.add("{\"id\":");
        try output.integer(id);
        try output.add(",\"kind\":");
        try output.string(kindName(record.kind));
        try output.add(",\"name\":");
        if (record.kind == .string_literal) {
            var name_buffer: [32]u8 = undefined;
            try output.string(std.fmt.bufPrint(&name_buffer, ".L.str.{d}", .{id}) catch unreachable);
        } else {
            try output.string(store.tree.tokSlice(name_token));
        }
        const range_token = if (record.kind == .string_literal and !store.types.isSourceToken(name_token))
            symbolNameToken(store.records.items[record.owner - 1].node.get(store.tree))
        else
            name_token;
        try output.add(",\"range\":");
        try store.types.writeTokenRange(output, range_token);

        switch (record.kind) {
            .variable => {
                const variable = node.variable;
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(variable.qt));
                try output.add(",\"linkage\":");
                try output.string(if (variable.storage_class == .static) "internal" else "external");
                try output.add(",\"storage\":");
                try output.string(if (variable.thread_local)
                    "thread"
                else switch (variable.storage_class) {
                    .@"extern" => "extern",
                    .register => "register",
                    else => "static",
                });
                const definition = variable.storage_class != .@"extern" or variable.initializer != null;
                try output.add(",\"definition\":");
                try output.add(if (definition) "true" else "false");
                if (definition) {
                    try output.add(",\"initializer\":");
                    try serialize_initializers.write(
                        output,
                        variable.initializer,
                        variable.qt,
                        store.types,
                        store.resolver(),
                    );
                }
            },
            .function => {
                const function = node.function;
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(function.qt));
                try output.add(",\"linkage\":");
                try output.string(if (function.static) "internal" else "external");
                try output.add(",\"definition\":");
                try output.add(if (function.body != null) "true" else "false");
            },
            .parameter => {
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(node.param.qt));
                try output.add(",\"owner\":");
                try output.integer(record.owner);
            },
            .typedef => {
                try output.add(",\"type\":");
                try output.integer(store.types.by_typedef.get(record.node) orelse return error.UnsupportedType);
            },
            .record, .@"enum" => {
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(record.type_qt));
            },
            .enumerator => {
                const value = store.tree.value_map.get(record.node) orelse return error.UnsupportedValue;
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(record.type_qt));
                try output.add(",\"owner\":");
                try output.integer(record.owner);
                try output.add(",\"value\":{\"kind\":\"integer\",\"bits\":");
                try output.integer(record.type_qt.bitSizeof(store.tree.comp));
                try output.add(",\"signed\":");
                try output.add(if (record.type_qt.signedness(store.tree.comp) == .signed) "true" else "false");
                try output.add(",\"value\":");
                try store.types.writeIntegerText(output, value, record.type_qt);
                try output.byte('}');
            },
            .string_literal => {
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(record.type_qt));
                try output.add(",\"linkage\":\"internal\",\"storage\":\"static\",\"definition\":true,\"initializer\":");
                try serialize_initializers.write(
                    output,
                    record.node,
                    record.type_qt,
                    store.types,
                    store.resolver(),
                );
            },
        }
        try output.byte('}');
    }

    fn resolveNode(context: *const anyopaque, raw_node: u32) ?u32 {
        const store: *const Store = @ptrCast(@alignCast(context));
        const node: aro.Tree.Node.Index = @fromBackingInt(@intCast(raw_node));
        return store.by_node.get(node);
    }
};

fn symbolNameToken(node: aro.Tree.Node) aro.Tree.TokenIndex {
    return switch (node) {
        .variable => |decl| decl.name_tok,
        .function => |decl| decl.name_tok,
        .param => |decl| decl.name_tok,
        .typedef => |decl| decl.name_tok,
        .struct_decl, .union_decl, .enum_decl => |decl| decl.name_or_kind_tok,
        .struct_forward_decl, .union_forward_decl, .enum_forward_decl => |decl| decl.name_or_kind_tok,
        .enum_field => |field| field.name_tok,
        .string_literal_expr => |literal| literal.literal_tok,
        else => unreachable,
    };
}

fn kindName(kind: Store.Kind) []const u8 {
    return switch (kind) {
        .variable => "variable",
        .function => "function",
        .parameter => "parameter",
        .typedef => "typedef",
        .record => "record",
        .@"enum" => "enum",
        .enumerator => "enumerator",
        .string_literal => "variable",
    };
}
