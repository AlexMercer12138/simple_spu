const std = @import("std");
const aro = @import("aro");
const source_provider = @import("source_provider.zig");

pub const Store = struct {
    allocator: std.mem.Allocator,
    tree: *const aro.Tree,
    sources: *const source_provider.State,
    entries: std.ArrayList(Entry) = .empty,
    by_type: std.AutoHashMapUnmanaged(aro.QualType, u32) = .empty,
    by_typedef: std.AutoHashMapUnmanaged(aro.Tree.Node.Index, u32) = .empty,

    const Entry = union(enum) {
        aro_type: aro.QualType,
        typedef_decl: struct {
            node: aro.Tree.Node.Index,
            name: []const u8,
            target: aro.QualType,
        },
    };

    pub fn init(
        allocator: std.mem.Allocator,
        tree: *const aro.Tree,
        sources: *const source_provider.State,
    ) Store {
        return .{ .allocator = allocator, .tree = tree, .sources = sources };
    }

    pub fn deinit(store: *Store) void {
        store.entries.deinit(store.allocator);
        store.by_type.deinit(store.allocator);
        store.by_typedef.deinit(store.allocator);
    }

    pub fn collect(store: *Store) anyerror!void {
        for (store.tree.root_decls.items) |node_index| {
            switch (node_index.get(store.tree)) {
                .typedef => |decl| if (!decl.implicit and store.isSourceToken(decl.name_tok)) {
                    _ = try store.internTypedef(node_index, store.tree.tokSlice(decl.name_tok), decl.qt);
                },
                .function => |decl| if (store.isSourceToken(decl.name_tok)) {
                    _ = try store.intern(decl.qt);
                },
                .variable => |decl| if (!decl.implicit and store.isSourceToken(decl.name_tok)) {
                    _ = try store.intern(decl.qt);
                },
                .struct_decl, .union_decl, .enum_decl => |decl| if (store.isSourceToken(decl.name_or_kind_tok)) {
                    _ = try store.intern(decl.container_qt);
                },
                .struct_forward_decl, .union_forward_decl, .enum_forward_decl => |decl| if (store.isSourceToken(decl.name_or_kind_tok)) {
                    _ = try store.intern(decl.container_qt);
                },
                else => {},
            }
        }
    }

    pub fn intern(store: *Store, qt: aro.QualType) anyerror!u32 {
        if (qt.isInvalid() or qt.isAuto()) return error.UnsupportedType;
        if (qt.type(store.tree.comp) == .typedef) {
            const typedef = qt.type(store.tree.comp).typedef;
            if (store.by_typedef.get(typedef.decl_node)) |id| {
                try store.by_type.put(store.allocator, qt, id);
                return id;
            }
        }
        if (store.by_type.get(qt)) |id| return id;
        for (store.entries.items, 0..) |entry, index| switch (entry) {
            .typedef_decl => {},
            .aro_type => |existing| {
                if (std.meta.activeTag(existing.type(store.tree.comp)) == std.meta.activeTag(qt.type(store.tree.comp)) and
                    existing.eqlQualified(qt, store.tree.comp))
                {
                    const id: u32 = @intCast(index + 1);
                    try store.by_type.put(store.allocator, qt, id);
                    return id;
                }
            },
        };

        const id: u32 = @intCast(store.entries.items.len + 1);
        try store.entries.append(store.allocator, .{ .aro_type = qt });
        try store.by_type.put(store.allocator, qt, id);
        try store.collectChildren(qt);
        return id;
    }

    pub fn internTypedef(
        store: *Store,
        node: aro.Tree.Node.Index,
        name: []const u8,
        target: aro.QualType,
    ) anyerror!u32 {
        if (store.by_typedef.get(node)) |id| return id;
        const id: u32 = @intCast(store.entries.items.len + 1);
        try store.entries.append(store.allocator, .{ .typedef_decl = .{
            .node = node,
            .name = name,
            .target = target,
        } });
        try store.by_typedef.put(store.allocator, node, id);
        _ = try store.intern(target);
        return id;
    }

    fn collectChildren(store: *Store, qt: aro.QualType) anyerror!void {
        switch (qt.type(store.tree.comp)) {
            .void, .bool, .int, .float => {},
            .atomic => |child| _ = try store.intern(child),
            .pointer => |pointer| _ = try store.intern(pointer.child),
            .array => |array| _ = try store.intern(array.elem),
            .func => |function| {
                _ = try store.intern(function.return_type);
                for (function.params) |param| _ = try store.intern(param.qt);
            },
            .@"struct", .@"union" => |record| for (record.fields) |field| {
                _ = try store.intern(field.qt);
            },
            .@"enum" => |enumeration| _ = try store.intern(enumeration.tag orelse aro.QualType.int),
            .typedef => |typedef| {
                if (!store.by_typedef.contains(typedef.decl_node)) {
                    _ = try store.internTypedef(typedef.decl_node, typedef.name.lookup(store.tree.comp), typedef.base);
                }
            },
            else => return error.UnsupportedType,
        }
    }

    pub fn write(store: *Store, output: anytype) anyerror!void {
        try output.byte('[');
        for (store.entries.items, 0..) |entry, index| {
            if (index != 0) try output.byte(',');
            try store.writeEntry(output, @intCast(index + 1), entry);
        }
        try output.byte(']');
    }

    fn writeEntry(store: *Store, output: anytype, id: u32, entry: Entry) anyerror!void {
        switch (entry) {
            .typedef_decl => |typedef| {
                try store.writeBase(output, id, "typedef", null, typedef.target, false);
                try output.add(",\"name\":");
                try output.string(typedef.name);
                try output.add(",\"target\":");
                try output.integer(try store.intern(typedef.target));
                try output.byte('}');
            },
            .aro_type => |qt| try store.writeAroType(output, id, qt),
        }
    }

    fn writeAroType(store: *Store, output: anytype, id: u32, qt: aro.QualType) anyerror!void {
        const ty = qt.type(store.tree.comp);
        switch (ty) {
            .void => {
                try store.writeBase(output, id, "builtin", "void", qt, false);
                try output.byte('}');
            },
            .bool => {
                try store.writeBase(output, id, "builtin", "_Bool", qt, false);
                try output.byte('}');
            },
            .int => |integer| {
                try store.writeBase(output, id, "builtin", integerName(integer) orelse return error.UnsupportedType, qt, false);
                try output.byte('}');
            },
            .float => |floating| {
                try store.writeBase(output, id, "builtin", floatName(floating) orelse return error.UnsupportedType, qt, false);
                try output.byte('}');
            },
            .atomic => |child| try store.writeAtomic(output, id, qt, child),
            .pointer => |pointer| {
                try store.writeBase(output, id, "pointer", null, qt, false);
                try output.add(",\"pointee\":");
                try output.integer(try store.intern(pointer.child));
                try output.byte('}');
            },
            .array => |array| {
                const count = switch (array.len) {
                    .fixed, .static => |value| value,
                    else => return error.UnsupportedType,
                };
                try store.writeBase(output, id, "array", null, qt, false);
                try output.add(",\"element\":");
                try output.integer(try store.intern(array.elem));
                try output.add(",\"count\":");
                try output.integer(count);
                try output.byte('}');
            },
            .func => |function| {
                if (function.kind == .old_style) return error.UnsupportedType;
                try store.writeBase(output, id, "function", null, qt, false);
                try output.add(",\"returnType\":");
                try output.integer(try store.intern(function.return_type));
                try output.add(",\"parameters\":[");
                for (function.params, 0..) |param, param_index| {
                    if (param_index != 0) try output.byte(',');
                    try output.integer(try store.intern(param.qt));
                }
                try output.add("],\"variadic\":");
                try output.add(if (function.kind == .variadic) "true" else "false");
                try output.byte('}');
            },
            .@"struct" => |record| try store.writeRecord(output, id, qt, record, "struct"),
            .@"union" => |record| try store.writeRecord(output, id, qt, record, "union"),
            .@"enum" => |enumeration| try store.writeEnum(output, id, qt, enumeration),
            .typedef => |typedef| {
                const typedef_id = store.by_typedef.get(typedef.decl_node) orelse return error.UnsupportedType;
                if (typedef_id != id) return error.UnsupportedType;
                try store.writeBase(output, id, "typedef", null, qt, false);
                try output.add(",\"name\":");
                try output.string(typedef.name.lookup(store.tree.comp));
                try output.add(",\"target\":");
                try output.integer(try store.intern(typedef.base));
                try output.byte('}');
            },
            else => return error.UnsupportedType,
        }
    }

    fn writeAtomic(store: *Store, output: anytype, id: u32, qt: aro.QualType, child: aro.QualType) !void {
        switch (child.type(store.tree.comp)) {
            .bool => try store.writeBase(output, id, "builtin", "_Bool", qt, true),
            .int => |integer| try store.writeBase(output, id, "builtin", integerName(integer) orelse return error.UnsupportedType, qt, true),
            .pointer => |pointer| {
                try store.writeBase(output, id, "pointer", null, qt, true);
                try output.add(",\"pointee\":");
                try output.integer(try store.intern(pointer.child));
            },
            else => return error.UnsupportedType,
        }
        try output.byte('}');
    }

    fn writeRecord(
        store: *Store,
        output: anytype,
        id: u32,
        qt: aro.QualType,
        record: aro.Type.Record,
        kind: []const u8,
    ) !void {
        try store.writeBase(output, id, kind, null, qt, false);
        if (!record.isAnonymous(store.tree.comp)) {
            try output.add(",\"name\":");
            try output.string(record.name.lookup(store.tree.comp));
        }
        try output.add(",\"complete\":");
        try output.add(if (record.layout != null) "true" else "false");
        try output.add(",\"members\":[");
        for (record.fields, 0..) |field, field_index| {
            if (field_index != 0) try output.byte(',');
            try output.add("{\"name\":");
            try output.string(field.name.lookup(store.tree.comp));
            try output.add(",\"type\":");
            try output.integer(try store.intern(field.qt));
            const bit_width = field.bit_width.unpack();
            const offset = if (bit_width != null)
                @divFloor(field.layout.offset_bits, field.qt.bitSizeof(store.tree.comp)) * field.qt.sizeof(store.tree.comp)
            else
                @divExact(field.layout.offset_bits, 8);
            try output.add(",\"offset\":");
            try output.integer(offset);
            if (bit_width) |width| {
                try output.add(",\"bitOffset\":");
                try output.integer(field.layout.offset_bits - offset * 8);
                try output.add(",\"bitWidth\":");
                try output.integer(width);
            }
            try output.add(",\"range\":");
            const token = if (field.name_tok != 0)
                field.name_tok
            else if (field.field_decl.unpack()) |field_node|
                field_node.get(store.tree).record_field.name_or_first_tok
            else
                return error.InvalidSourceMapping;
            try store.writeTokenRange(output, token);
            try output.byte('}');
        }
        try output.add("]}");
    }

    fn writeEnum(
        store: *Store,
        output: anytype,
        id: u32,
        qt: aro.QualType,
        enumeration: aro.Type.Enum,
    ) !void {
        if (enumeration.incomplete) return error.UnsupportedType;
        const underlying = enumeration.tag orelse aro.QualType.int;
        try store.writeBase(output, id, "enum", null, qt, false);
        if (!enumeration.isAnonymous(store.tree.comp)) {
            try output.add(",\"name\":");
            try output.string(enumeration.name.lookup(store.tree.comp));
        }
        try output.add(",\"underlyingType\":");
        try output.integer(try store.intern(underlying));
        try output.add(",\"enumerators\":[");
        for (enumeration.fields, 0..) |field, field_index| {
            if (field_index != 0) try output.byte(',');
            const field_node = fieldNode(enumeration, field_index, store.tree) orelse return error.UnsupportedType;
            const value = store.tree.value_map.get(field_node) orelse return error.UnsupportedValue;
            try output.add("{\"name\":");
            try output.string(field.name.lookup(store.tree.comp));
            try output.add(",\"value\":");
            try store.writeIntegerText(output, value, underlying);
            try output.add(",\"range\":");
            try store.writeTokenRange(output, field.name_tok);
            try output.byte('}');
        }
        try output.add("]}");
    }

    fn writeBase(
        store: *Store,
        output: anytype,
        id: u32,
        kind: []const u8,
        builtin_name: ?[]const u8,
        qt: aro.QualType,
        atomic: bool,
    ) !void {
        try output.add("{\"id\":");
        try output.integer(id);
        try output.add(",\"kind\":");
        try output.string(kind);
        if (builtin_name) |name| {
            try output.add(",\"name\":");
            try output.string(name);
        }
        try output.add(",\"qualifiers\":[");
        var needs_comma = false;
        inline for (.{ .{ qt.@"const", "const" }, .{ qt.@"volatile", "volatile" }, .{ qt.restrict, "restrict" }, .{ atomic, "atomic" } }) |qualifier| {
            if (qualifier[0]) {
                if (needs_comma) try output.byte(',');
                try output.string(qualifier[1]);
                needs_comma = true;
            }
        }
        const layout = typeLayout(qt, store.tree.comp);
        try output.add("],\"size\":");
        try output.integer(layout.size);
        try output.add(",\"alignment\":");
        try output.integer(layout.alignment);
    }

    pub fn writeIntegerText(store: *Store, output: anytype, value: aro.Value, qt: aro.QualType) !void {
        if (qt.is(store.tree.comp, .bool)) {
            try output.string(if (value.isZero(store.tree.comp)) "0" else "1");
            return;
        }
        var text: std.Io.Writer.Allocating = .init(store.allocator);
        defer text.deinit();
        if (try value.print(qt, store.tree.comp, &text.writer) != null) return error.UnsupportedValue;
        const owned = try text.toOwnedSlice();
        defer store.allocator.free(owned);
        try output.string(if (std.mem.eql(u8, owned, "-0")) "0" else owned);
    }

    pub fn writeTokenRange(store: *Store, output: anytype, token: aro.Tree.TokenIndex) !void {
        const loc = store.tree.tokens.items(.loc)[token];
        const aro_source = store.tree.comp.getSource(loc.id);
        const file = store.sources.fileForAroId(loc.id) orelse return error.InvalidSourceMapping;
        const token_len: u32 = @intCast(store.tree.tokSlice(token).len);
        var mapper = aro.Source.OriginalLocationMapper.init(aro_source, file.source);
        const start = (try mapper.resolve(loc.byte_offset)).after_splice;
        const end_boundary = try mapper.resolve(loc.byte_offset + token_len);
        const end = if (token_len == 0) end_boundary.after_splice else end_boundary.before_splice;
        try output.add("{\"file\":");
        try output.integer(file.id);
        try output.add(",\"start\":");
        try writePosition(output, start);
        try output.add(",\"end\":");
        try writePosition(output, end);
        try output.byte('}');
    }

    pub fn isSourceToken(store: *const Store, token: aro.Tree.TokenIndex) bool {
        return store.sources.fileForAroId(store.tree.tokens.items(.loc)[token].id) != null;
    }
};

fn typeLayout(qt: aro.QualType, comp: *const aro.Compilation) struct { size: u64, alignment: u32 } {
    const base_type = qt.base(comp).type;
    const size = switch (base_type) {
        .void, .func => 0,
        else => qt.sizeofOrNull(comp) orelse 0,
    };
    const alignment: u32 = switch (base_type) {
        .void => 1,
        .func => 4,
        .@"struct", .@"union" => |record| if (record.layout == null) 1 else qt.alignof(comp),
        else => qt.alignof(comp),
    };
    return .{ .size = size, .alignment = alignment };
}

fn integerName(integer: aro.Type.Int) ?[]const u8 {
    return switch (integer) {
        .char => "char",
        .schar => "signed char",
        .uchar => "unsigned char",
        .short => "short",
        .ushort => "unsigned short",
        .int => "int",
        .uint => "unsigned int",
        .long => "long",
        .ulong => "unsigned long",
        .long_long => "long long",
        .ulong_long => "unsigned long long",
        else => null,
    };
}

fn floatName(floating: aro.Type.Float) ?[]const u8 {
    return switch (floating) {
        .float => "float",
        .double => "double",
        .long_double => "long double",
        else => null,
    };
}

fn fieldNode(enumeration: aro.Type.Enum, index: usize, tree: *const aro.Tree) ?aro.Tree.Node.Index {
    const decl = enumeration.decl_node.get(tree);
    const fields = switch (decl) {
        .enum_decl => |container| container.fields,
        else => return null,
    };
    if (index >= fields.len) return null;
    return fields[index];
}

fn writePosition(output: anytype, position: aro.Source.OriginalPosition) !void {
    try output.add("{\"line\":");
    try output.integer(position.line);
    try output.add(",\"column\":");
    try output.integer(position.column);
    try output.add(",\"byteOffset\":");
    try output.integer(position.byte_offset);
    try output.byte('}');
}
