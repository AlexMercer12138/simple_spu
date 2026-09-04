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
        definition_node: ?aro.Tree.Node.Index = null,
        owner: u32 = 0,
        type_qt: aro.QualType = .invalid,
        local: bool = false,
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
                    _ = try store.add(.variable, node_index, decl.qt, 0, decl.definition);
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

        for (store.tree.root_decls.items) |node_index| switch (node_index.get(store.tree)) {
            .function => |decl| if (decl.body) |body| {
                try store.collectLocals(body);
            },
            else => {},
        };

        const source_symbol_count = store.records.items.len;
        var record_index: usize = 0;
        while (record_index < source_symbol_count) : (record_index += 1) {
            const record = store.records.items[record_index];
            if (record.kind != .variable) continue;
            const variable = (record.definition_node orelse record.node).get(store.tree).variable;
            if (variable.initializer) |initializer| {
                _ = try store.collectInitializerStrings(initializer, variable.qt, @intCast(record_index + 1));
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
        return store.addRecord(kind, node, type_qt, owner, definition, false);
    }

    fn addLocal(store: *Store, node: aro.Tree.Node.Index, qt: aro.QualType) !u32 {
        return store.addRecord(.variable, node, qt, 0, null, true);
    }

    fn addRecord(
        store: *Store,
        kind: Kind,
        node: aro.Tree.Node.Index,
        type_qt: aro.QualType,
        owner: u32,
        definition: ?aro.Tree.Node.Index,
        local: bool,
    ) !u32 {
        if (store.by_node.get(node)) |id| {
            if (definition) |definition_node| store.records.items[id - 1].definition_node = definition_node;
            return id;
        }
        if (definition) |definition_node| if (store.by_node.get(definition_node)) |id| {
            store.records.items[id - 1].definition_node = definition_node;
            try store.by_node.put(store.allocator, node, id);
            return id;
        };
        const id: u32 = @intCast(store.records.items.len + 1);
        try store.records.append(store.allocator, .{
            .kind = kind,
            .node = node,
            .definition_node = definition,
            .owner = owner,
            .type_qt = type_qt,
            .local = local,
        });
        try store.by_node.put(store.allocator, node, id);
        if (definition) |definition_node| try store.by_node.put(store.allocator, definition_node, id);
        return id;
    }

    fn collectLocals(store: *Store, node_index: aro.Tree.Node.Index) !void {
        switch (node_index.get(store.tree)) {
            .variable => |decl| if (!decl.implicit and store.types.isSourceToken(decl.name_tok)) {
                _ = try store.addLocal(node_index, decl.qt);
            },
            .typedef => |decl| if (!decl.implicit and store.types.isSourceToken(decl.name_tok)) {
                _ = try store.types.internTypedef(node_index, store.tree.tokSlice(decl.name_tok), decl.qt);
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
            .compound_stmt => |compound| for (compound.body) |child| {
                try store.collectLocals(child);
            },
            .if_stmt => |statement| {
                try store.collectLocals(statement.then_body);
                if (statement.else_body) |child| try store.collectLocals(child);
            },
            .switch_stmt => |statement| try store.collectLocals(statement.body),
            .case_stmt => |statement| try store.collectLocals(statement.body),
            .default_stmt => |statement| try store.collectLocals(statement.body),
            .while_stmt => |statement| try store.collectLocals(statement.body),
            .do_while_stmt => |statement| try store.collectLocals(statement.body),
            .for_stmt => |statement| {
                if (statement.init) |initializer_node| try store.collectLocals(initializer_node);
                try store.collectLocals(statement.body);
            },
            .labeled_stmt => |statement| try store.collectLocals(statement.body),
            .decl_stmt => |statement| for (statement.decls) |decl| try store.collectLocals(decl),
            else => {},
        }
    }

    fn collectInitializerStrings(
        store: *Store,
        node: aro.Tree.Node.Index,
        destination_qt: aro.QualType,
        owner: u32,
    ) !?u32 {
        if (store.by_node.get(node)) |id| return id;
        return switch (node.get(store.tree)) {
            .string_literal_expr => |literal| blk: {
                if (destination_qt.get(store.tree.comp, .pointer) == null) break :blk null;
                const id = try store.add(.string_literal, node, literal.qt, owner, null);
                _ = try store.types.intern(literal.qt);
                break :blk id;
            },
            .array_init_expr => |initializer| blk: {
                const array = destination_qt.get(store.tree.comp, .array) orelse return error.UnsupportedInitializer;
                for (initializer.items) |item| switch (item.get(store.tree)) {
                    .array_filler_expr => {},
                    else => _ = try store.collectInitializerStrings(item, array.elem, owner),
                };
                break :blk null;
            },
            .struct_init_expr => |initializer| blk: {
                const record = destination_qt.get(store.tree.comp, .@"struct") orelse return error.UnsupportedInitializer;
                if (initializer.items.len != record.fields.len) return error.UnsupportedInitializer;
                for (initializer.items, record.fields) |item, field| {
                    _ = try store.collectInitializerStrings(item, field.qt, owner);
                }
                break :blk null;
            },
            .union_init_expr => |initializer| blk: {
                if (initializer.initializer) |item| {
                    const record = destination_qt.get(store.tree.comp, .@"union") orelse return error.UnsupportedInitializer;
                    if (initializer.field_index >= record.fields.len) return error.UnsupportedInitializer;
                    _ = try store.collectInitializerStrings(item, record.fields[initializer.field_index].qt, owner);
                }
                break :blk null;
            },
            .cast => |cast| if (try store.collectInitializerStrings(cast.operand, destination_qt, owner)) |id| blk: {
                try store.by_node.put(store.allocator, node, id);
                break :blk id;
            } else null,
            .paren_expr => |paren| if (try store.collectInitializerStrings(paren.operand, destination_qt, owner)) |id| blk: {
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
        const semantic_node = (record.definition_node orelse record.node).get(store.tree);
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
                const variable = semantic_node.variable;
                try output.add(",\"type\":");
                try output.integer(try store.types.intern(variable.qt));
                try output.add(",\"linkage\":");
                try output.string(if (record.local)
                    (if (variable.storage_class == .@"extern") "external" else "none")
                else if (variable.storage_class == .static)
                    "internal"
                else
                    "external");
                try output.add(",\"storage\":");
                try output.string(if (variable.thread_local)
                    "thread"
                else switch (variable.storage_class) {
                    .@"extern" => "extern",
                    .register => "register",
                    .static => "static",
                    .auto => if (record.local) "automatic" else "static",
                });
                const definition = variable.storage_class != .@"extern" or variable.initializer != null;
                try output.add(",\"definition\":");
                try output.add(if (definition) "true" else "false");
                if ((!record.local and definition) or
                    (record.local and variable.storage_class == .static))
                {
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
                const function = semantic_node.function;
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
