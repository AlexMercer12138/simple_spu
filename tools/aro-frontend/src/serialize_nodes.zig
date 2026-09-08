const std = @import("std");
const aro = @import("aro");
const serialize_symbols = @import("serialize_symbols.zig");
const serialize_types = @import("serialize_types.zig");
const serialize_values = @import("serialize_values.zig");

const Category = enum { declaration, statement, expression };

const Range = struct {
    file: u32,
    start: aro.Source.OriginalPosition,
    end: aro.Source.OriginalPosition,

    fn eql(a: Range, b: Range) bool {
        return a.file == b.file and std.meta.eql(a.start, b.start) and std.meta.eql(a.end, b.end);
    }
};

const Record = struct {
    category: Category,
    kind: []const u8,
    token: aro.Tree.TokenIndex,
    children: std.ArrayList(u32) = .empty,
    initializer_indices: std.ArrayList(u32) = .empty,
    qt: aro.QualType = .invalid,
    value_category: ?[]const u8 = null,
    symbol: ?u32 = null,
    operator: ?[]const u8 = null,
    label: ?[]const u8 = null,
    member_index: ?u32 = null,
    target_qt: ?aro.QualType = null,
    computation_qt: ?aro.QualType = null,
    conversion: ?[]const u8 = null,
    constant_node: ?aro.Tree.Node.Index = null,
    type_info_value: ?u64 = null,
    case_value_node: ?aro.Tree.Node.Index = null,
    declaration_node: ?aro.Tree.Node.Index = null,
    for_clause_mask: ?u3 = null,
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    tree: *const aro.Tree,
    preprocessor: ?*const aro.Preprocessor,
    types: *serialize_types.Store,
    symbols: *const serialize_symbols.Store,
    records: std.ArrayList(Record) = .empty,
    declarations: std.ArrayList(u32) = .empty,

    pub fn init(
        allocator: std.mem.Allocator,
        tree: *const aro.Tree,
        preprocessor: ?*const aro.Preprocessor,
        types: *serialize_types.Store,
        symbols: *const serialize_symbols.Store,
    ) Store {
        return .{
            .allocator = allocator,
            .tree = tree,
            .preprocessor = preprocessor,
            .types = types,
            .symbols = symbols,
        };
    }

    pub fn deinit(store: *Store) void {
        for (store.records.items) |*record| {
            record.children.deinit(store.allocator);
            record.initializer_indices.deinit(store.allocator);
        }
        store.records.deinit(store.allocator);
        store.declarations.deinit(store.allocator);
    }

    pub fn collect(store: *Store) !void {
        for (store.tree.root_decls.items) |node_index| {
            if (store.isSourceBackedUnsupportedRoot(node_index)) return error.UnknownAroNode;
            if (!store.isPublicRoot(node_index)) continue;
            const id = try store.serializeDeclaration(node_index, true);
            try store.declarations.append(store.allocator, id);
        }
    }

    fn isSourceBackedUnsupportedRoot(store: *const Store, node_index: aro.Tree.Node.Index) bool {
        const token: aro.Tree.TokenIndex = switch (node_index.get(store.tree)) {
            .global_asm => |decl| decl.asm_tok,
            else => return false,
        };
        return store.types.isSourceToken(token);
    }

    fn isPublicRoot(store: *const Store, node_index: aro.Tree.Node.Index) bool {
        const token: aro.Tree.TokenIndex = switch (node_index.get(store.tree)) {
            .function => |decl| decl.name_tok,
            .variable => |decl| if (decl.implicit) return false else decl.name_tok,
            .typedef => |decl| if (decl.implicit) return false else decl.name_tok,
            .struct_decl, .union_decl, .enum_decl => |decl| decl.name_or_kind_tok,
            .struct_forward_decl, .union_forward_decl, .enum_forward_decl => |decl| decl.name_or_kind_tok,
            .static_assert => |decl| decl.assert_tok,
            .empty_decl => |decl| decl.semicolon,
            else => return false,
        };
        return store.types.isSourceToken(token);
    }

    fn addRecord(store: *Store, record: Record) !u32 {
        const id: u32 = @intCast(store.records.items.len + 1);
        try store.records.append(store.allocator, record);
        return id;
    }

    fn addChild(store: *Store, parent: u32, child: u32) !void {
        try store.records.items[parent - 1].children.append(store.allocator, child);
    }

    fn serializeDeclaration(store: *Store, node_index: aro.Tree.Node.Index, file_scope: bool) anyerror!u32 {
        return switch (node_index.get(store.tree)) {
            .function => |decl| blk: {
                const id = try store.addRecord(.{
                    .category = .declaration,
                    .kind = if (decl.body == null) "function-declaration" else "function-definition",
                    .token = decl.name_tok,
                    .qt = decl.qt,
                    .symbol = try store.symbolId(node_index),
                });
                _ = try store.types.intern(decl.qt);
                const function = decl.qt.get(store.tree.comp, .func) orelse return error.UnsupportedType;
                for (function.params) |param| if (param.name != .empty) if (param.node.unpack()) |param_node| {
                    if (!store.types.isSourceToken(param_node.get(store.tree).param.name_tok)) continue;
                    try store.addChild(id, try store.serializeDeclaration(param_node, false));
                };
                if (decl.body) |body| try store.addChild(id, try store.serializeStatement(body));
                break :blk id;
            },
            .param => |decl| blk: {
                _ = try store.types.intern(decl.qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "parameter-declaration",
                    .token = decl.name_tok,
                    .qt = decl.qt,
                    .symbol = try store.symbolId(node_index),
                });
            },
            .variable => |decl| blk: {
                _ = try store.types.intern(decl.qt);
                const id = try store.addRecord(.{
                    .category = .declaration,
                    .kind = "variable-declaration",
                    .token = decl.name_tok,
                    .qt = decl.qt,
                    .symbol = try store.symbolId(node_index),
                });
                if (decl.initializer) |initializer| if (!file_scope and decl.storage_class != .static) {
                    try store.addChild(id, try store.serializeConverted(initializer, "assignment", decl.qt, false));
                };
                break :blk id;
            },
            .typedef => |decl| blk: {
                _ = try store.types.internTypedef(node_index, store.tree.tokSlice(decl.name_tok), decl.qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "typedef-declaration",
                    .token = decl.name_tok,
                    .qt = decl.qt,
                    .symbol = try store.symbolId(node_index),
                    .declaration_node = node_index,
                });
            },
            .struct_decl, .union_decl => |decl| blk: {
                _ = try store.types.intern(decl.container_qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "record-declaration",
                    .token = decl.name_or_kind_tok,
                    .qt = decl.container_qt,
                    .symbol = try store.symbolId(node_index),
                });
            },
            .struct_forward_decl, .union_forward_decl => |decl| blk: {
                _ = try store.types.intern(decl.container_qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "record-declaration",
                    .token = decl.name_or_kind_tok,
                    .qt = decl.container_qt,
                    .symbol = try store.symbolId(node_index),
                });
            },
            .enum_decl => |decl| blk: {
                _ = try store.types.intern(decl.container_qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "enum-declaration",
                    .token = decl.name_or_kind_tok,
                    .qt = decl.container_qt,
                    .symbol = try store.symbolId(node_index),
                });
            },
            .enum_forward_decl => |decl| blk: {
                _ = try store.types.intern(decl.container_qt);
                break :blk try store.addRecord(.{
                    .category = .declaration,
                    .kind = "enum-declaration",
                    .token = decl.name_or_kind_tok,
                    .qt = decl.container_qt,
                    .symbol = try store.symbolId(node_index),
                });
            },
            .static_assert => |decl| blk: {
                const id = try store.addRecord(.{ .category = .declaration, .kind = "static-assert", .token = decl.assert_tok });
                try store.addChild(id, try store.serializeExpression(decl.cond));
                if (decl.message) |message| try store.addChild(id, try store.serializeExpression(message));
                break :blk id;
            },
            else => error.UnknownAroNode,
        };
    }

    fn serializeStatement(store: *Store, node_index: aro.Tree.Node.Index) anyerror!u32 {
        return switch (node_index.get(store.tree)) {
            .compound_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "compound", .token = statement.l_brace_tok });
                for (statement.body) |child| try store.addChild(id, try store.serializeBlockItem(child));
                break :blk id;
            },
            .return_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "return", .token = statement.return_tok });
                switch (statement.operand) {
                    .expr => |expr| try store.addChild(id, try store.serializeConverted(expr, "return", statement.return_qt, false)),
                    .implicit, .none => {},
                }
                break :blk id;
            },
            .if_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "if", .token = statement.if_tok });
                try store.addChild(id, try store.serializeExpression(statement.cond));
                try store.addChild(id, try store.serializeStatement(statement.then_body));
                if (statement.else_body) |child| try store.addChild(id, try store.serializeStatement(child));
                break :blk id;
            },
            .while_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "while", .token = statement.while_tok });
                try store.addChild(id, try store.serializeExpression(statement.cond));
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .do_while_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "do-while", .token = statement.do_tok });
                try store.addChild(id, try store.serializeStatement(statement.body));
                try store.addChild(id, try store.serializeExpression(statement.cond));
                break :blk id;
            },
            .for_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "for", .token = statement.for_tok,
                    .for_clause_mask = @as(u3, if (statement.init != null) 1 else 0) |
                        @as(u3, if (statement.cond != null) 2 else 0) |
                        @as(u3, if (statement.incr != null) 4 else 0) });
                if (statement.init) |initializer_node| try store.addChild(id, try store.serializeBlockItem(initializer_node));
                if (statement.cond) |expr| try store.addChild(id, try store.serializeExpression(expr));
                if (statement.incr) |expr| try store.addChild(id, try store.serializeExpression(expr));
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .switch_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "switch", .token = statement.switch_tok });
                try store.addChild(id, try store.serializeExpression(statement.cond));
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .case_stmt => |statement| blk: {
                const id = try store.addRecord(.{
                    .category = .statement,
                    .kind = "case",
                    .token = statement.case_tok,
                    .case_value_node = statement.start,
                });
                try store.addChild(id, try store.serializeExpression(statement.start));
                if (statement.end) |end| try store.addChild(id, try store.serializeExpression(end));
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .default_stmt => |statement| blk: {
                const id = try store.addRecord(.{ .category = .statement, .kind = "default", .token = statement.default_tok });
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .break_stmt => |statement| store.serializeLeaf(statement.break_tok, "break"),
            .continue_stmt => |statement| store.serializeLeaf(statement.continue_tok, "continue"),
            .goto_stmt => |statement| store.addRecord(.{
                .category = .statement,
                .kind = "goto",
                .token = statement.label_tok,
                .label = store.tree.tokSlice(statement.label_tok),
            }),
            .labeled_stmt => |statement| blk: {
                const id = try store.addRecord(.{
                    .category = .statement,
                    .kind = "label",
                    .token = statement.label_tok,
                    .label = store.tree.tokSlice(statement.label_tok),
                });
                try store.addChild(id, try store.serializeStatement(statement.body));
                break :blk id;
            },
            .null_stmt => |statement| store.serializeLeaf(statement.semicolon_or_r_brace_tok, "empty"),
            .decl_stmt => |statement| store.serializeDeclarationStatement(statement.decls),
            else => store.serializeExpressionStatement(node_index),
        };
    }

    fn serializeLeaf(store: *Store, token: aro.Tree.TokenIndex, kind: []const u8) !u32 {
        return store.addRecord(.{ .category = .statement, .kind = kind, .token = token });
    }

    fn serializeBlockItem(store: *Store, node_index: aro.Tree.Node.Index) anyerror!u32 {
        return switch (node_index.get(store.tree)) {
            .variable,
            .typedef,
            .struct_decl,
            .union_decl,
            .enum_decl,
            .struct_forward_decl,
            .union_forward_decl,
            .enum_forward_decl,
            .static_assert,
            .function,
            => store.serializeDeclarationStatement(&.{node_index}),
            else => store.serializeStatement(node_index),
        };
    }

    fn serializeDeclarationStatement(store: *Store, declarations: []const aro.Tree.Node.Index) anyerror!u32 {
        if (declarations.len == 0) return error.UnknownAroNode;
        const id = try store.addRecord(.{
            .category = .statement,
            .kind = "declaration-statement",
            .token = declarations[0].tok(store.tree),
        });
        for (declarations) |declaration| try store.addChild(id, try store.serializeDeclaration(declaration, false));
        return id;
    }

    fn serializeExpressionStatement(store: *Store, node_index: aro.Tree.Node.Index) anyerror!u32 {
        const id = try store.addRecord(.{
            .category = .statement,
            .kind = "expression-statement",
            .token = node_index.tok(store.tree),
        });
        try store.addChild(id, try store.serializeExpression(node_index));
        return id;
    }

    fn serializeExpression(store: *Store, node_index: aro.Tree.Node.Index) anyerror!u32 {
        return switch (node_index.get(store.tree)) {
            .int_literal, .bool_literal => |literal| store.serializeLiteral(node_index, literal.literal_tok, literal.qt, "integer-literal"),
            .char_literal => |literal| store.serializeLiteral(node_index, literal.literal_tok, literal.qt, "character-literal"),
            .float_literal => |literal| store.serializeLiteral(node_index, literal.literal_tok, literal.qt, "floating-literal"),
            .string_literal_expr => |literal| store.serializeLiteral(node_index, literal.literal_tok, literal.qt, "string-literal"),
            .builtin_call_expr => |builtin| blk: {
                const name = store.tree.tokSlice(builtin.builtin_tok);
                if (!std.mem.eql(u8, name, "__builtin_offsetof") and !std.mem.eql(u8, name, "__builtin_bitoffsetof")) return error.UnknownAroNode;
                break :blk store.serializeLiteral(node_index, builtin.builtin_tok, builtin.qt, "integer-literal");
            },
            .decl_ref_expr, .enumeration_ref => |reference| blk: {
                _ = try store.types.intern(reference.qt);
                break :blk try store.addRecord(.{
                    .category = .expression,
                    .kind = "declaration-reference",
                    .token = reference.name_tok,
                    .qt = reference.qt,
                    .value_category = store.valueCategory(node_index, reference.qt),
                    .symbol = try store.symbolId(reference.decl),
                });
            },
            .addr_of_expr => |unary| store.serializeUnary(node_index, unary, "&"),
            .deref_expr => |unary| store.serializeUnary(node_index, unary, "*"),
            .plus_expr => |unary| store.serializeUnary(node_index, unary, "+"),
            .negate_expr => |unary| store.serializeUnary(node_index, unary, "-"),
            .bit_not_expr => |unary| store.serializeUnary(node_index, unary, "~"),
            .bool_not_expr => |unary| store.serializeUnary(node_index, unary, "!"),
            .pre_inc_expr => |unary| store.serializeUnary(node_index, unary, "pre++"),
            .pre_dec_expr => |unary| store.serializeUnary(node_index, unary, "pre--"),
            .post_inc_expr => |unary| store.serializeUnary(node_index, unary, "post++"),
            .post_dec_expr => |unary| store.serializeUnary(node_index, unary, "post--"),
            .paren_expr => |unary| store.serializeUnary(node_index, unary, "parentheses"),
            .assign_expr => |binary| store.serializeAssignment(binary, "="),
            .mul_assign_expr => |binary| store.serializeCompoundAssignment(binary, "*="),
            .div_assign_expr => |binary| store.serializeCompoundAssignment(binary, "/="),
            .mod_assign_expr => |binary| store.serializeCompoundAssignment(binary, "%="),
            .add_assign_expr => |binary| store.serializeCompoundAssignment(binary, "+="),
            .sub_assign_expr => |binary| store.serializeCompoundAssignment(binary, "-="),
            .shl_assign_expr => |binary| store.serializeCompoundAssignment(binary, "<<="),
            .shr_assign_expr => |binary| store.serializeCompoundAssignment(binary, ">>="),
            .bit_and_assign_expr => |binary| store.serializeCompoundAssignment(binary, "&="),
            .bit_xor_assign_expr => |binary| store.serializeCompoundAssignment(binary, "^="),
            .bit_or_assign_expr => |binary| store.serializeCompoundAssignment(binary, "|="),
            .comma_expr => |binary| store.serializeBinary(binary, ",", false),
            .bool_or_expr => |binary| store.serializeBinary(binary, "||", false),
            .bool_and_expr => |binary| store.serializeBinary(binary, "&&", false),
            .bit_or_expr => |binary| store.serializeBinary(binary, "|", true),
            .bit_xor_expr => |binary| store.serializeBinary(binary, "^", true),
            .bit_and_expr => |binary| store.serializeBinary(binary, "&", true),
            .equal_expr => |binary| store.serializeBinary(binary, "==", true),
            .not_equal_expr => |binary| store.serializeBinary(binary, "!=", true),
            .less_than_expr => |binary| store.serializeBinary(binary, "<", true),
            .less_than_equal_expr => |binary| store.serializeBinary(binary, "<=", true),
            .greater_than_expr => |binary| store.serializeBinary(binary, ">", true),
            .greater_than_equal_expr => |binary| store.serializeBinary(binary, ">=", true),
            .shl_expr => |binary| store.serializeBinary(binary, "<<", false),
            .shr_expr => |binary| store.serializeBinary(binary, ">>", false),
            .add_expr => |binary| store.serializeBinary(binary, "+", true),
            .sub_expr => |binary| store.serializeBinary(binary, "-", true),
            .mul_expr => |binary| store.serializeBinary(binary, "*", true),
            .div_expr => |binary| store.serializeBinary(binary, "/", true),
            .mod_expr => |binary| store.serializeBinary(binary, "%", true),
            .cast => |cast| store.serializeCast(cast),
            .array_access_expr => |access| store.serializeSubscript(access),
            .member_access_expr => |access| store.serializeMember(node_index, access, false),
            .member_access_ptr_expr => |access| store.serializeMember(node_index, access, true),
            .call_expr => |call| store.serializeCall(call),
            .cond_expr, .binary_cond_expr, .builtin_choose_expr => |conditional| store.serializeConditional(conditional),
            .sizeof_expr => |info| store.serializeTypeInfo(info, "sizeof"),
            .alignof_expr => |info| store.serializeTypeInfo(info, "alignof"),
            .compound_literal_expr => |literal| store.serializeCompoundLiteral(literal),
            .generic_expr => |generic| store.serializeGeneric(generic),
            else => error.UnknownAroNode,
        };
    }

    fn serializeLiteral(store: *Store, node: aro.Tree.Node.Index, token: aro.Tree.TokenIndex, qt: aro.QualType, kind: []const u8) !u32 {
        _ = try store.types.intern(qt);
        return store.addRecord(.{
            .category = .expression,
            .kind = kind,
            .token = token,
            .qt = qt,
            .value_category = if (std.mem.eql(u8, kind, "string-literal")) "lvalue" else "rvalue",
            .constant_node = node,
        });
    }

    fn serializeUnary(store: *Store, node: aro.Tree.Node.Index, unary: aro.Tree.Node.Unary, operator: []const u8) anyerror!u32 {
        _ = try store.types.intern(unary.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "unary",
            .token = unary.op_tok,
            .qt = unary.qt,
            .value_category = store.valueCategory(node, unary.qt),
            .operator = operator,
        });
        try store.addChild(id, try store.serializeExpression(unary.operand));
        return id;
    }

    fn serializeAssignment(store: *Store, binary: aro.Tree.Node.Binary, operator: []const u8) anyerror!u32 {
        _ = try store.types.intern(binary.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "assignment",
            .token = binary.op_tok,
            .qt = binary.qt,
            .value_category = "rvalue",
            .operator = operator,
        });
        try store.addChild(id, try store.serializeExpression(binary.lhs));
        try store.addChild(id, try store.serializeConverted(binary.rhs, "assignment", binary.lhs.qt(store.tree), false));
        return id;
    }

    fn serializeCompoundAssignment(store: *Store, binary: aro.Tree.Node.Binary, operator: []const u8) anyerror!u32 {
        var operation_node = binary.rhs;
        while (switch (operation_node.get(store.tree)) {
            .cast => |cast| cast.implicit,
            else => false,
        }) {
            operation_node = operation_node.get(store.tree).cast.operand;
        }
        const rhs = switch (operation_node.get(store.tree)) {
            .add_expr,
            .sub_expr,
            .mul_expr,
            .div_expr,
            .mod_expr,
            .shl_expr,
            .shr_expr,
            .bit_and_expr,
            .bit_xor_expr,
            .bit_or_expr,
            => |operation| operation.rhs,
            else => return error.UnknownAroNode,
        };
        _ = try store.types.intern(binary.qt);
        const computation_qt = operation_node.qt(store.tree);
        _ = try store.types.intern(computation_qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "assignment",
            .token = binary.op_tok,
            .qt = binary.qt,
            .value_category = "rvalue",
            .operator = operator,
            .computation_qt = computation_qt,
        });
        try store.addChild(id, try store.serializeExpression(binary.lhs));
        try store.addChild(id, try store.serializeExpression(rhs));
        return id;
    }

    fn serializeBinary(store: *Store, binary: aro.Tree.Node.Binary, operator: []const u8, arithmetic_conversions: bool) anyerror!u32 {
        _ = try store.types.intern(binary.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "binary",
            .token = binary.op_tok,
            .qt = binary.qt,
            .value_category = "rvalue",
            .operator = operator,
        });
        const arithmetic = arithmetic_conversions and !isPointer(binary.lhs.qt(store.tree), store.tree.comp) and !isPointer(binary.rhs.qt(store.tree), store.tree.comp);
        if (arithmetic) {
            const common_qt = binary.lhs.qt(store.tree);
            try store.addChild(id, try store.serializeConverted(binary.lhs, "usual-arithmetic", common_qt, true));
            try store.addChild(id, try store.serializeConverted(binary.rhs, "usual-arithmetic", common_qt, true));
        } else {
            try store.addChild(id, try store.serializeExpression(binary.lhs));
            try store.addChild(id, try store.serializeExpression(binary.rhs));
        }
        return id;
    }

    fn serializeSubscript(store: *Store, access: aro.Tree.Node.ArrayAccess) anyerror!u32 {
        _ = try store.types.intern(access.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "subscript",
            .token = access.l_bracket_tok,
            .qt = access.qt,
            .value_category = "lvalue",
        });
        try store.addChild(id, try store.serializeExpression(access.base));
        try store.addChild(id, try store.serializeExpression(access.index));
        return id;
    }

    fn serializeMember(
        store: *Store,
        node: aro.Tree.Node.Index,
        access: aro.Tree.Node.MemberAccess,
        through_pointer: bool,
    ) anyerror!u32 {
        _ = try store.types.intern(access.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "member",
            .token = access.access_tok,
            .qt = access.qt,
            .value_category = store.valueCategory(node, access.qt),
            .member_index = access.member_index,
        });
        const base = if (through_pointer and store.tree.isLval(access.base))
            try store.serializeConverted(access.base, "lvalue-to-rvalue", access.base.qt(store.tree), false)
        else
            try store.serializeExpression(access.base);
        try store.addChild(id, base);
        return id;
    }

    fn serializeCall(store: *Store, call: aro.Tree.Node.Call) anyerror!u32 {
        _ = try store.types.intern(call.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "call",
            .token = call.l_paren_tok,
            .qt = call.qt,
            .value_category = "rvalue",
        });
        try store.addChild(id, try store.serializeExpression(call.callee));
        const callee_qt = call.callee.qt(store.tree);
        const function = if (callee_qt.get(store.tree.comp, .pointer)) |pointer|
            pointer.child.get(store.tree.comp, .func)
        else
            callee_qt.get(store.tree.comp, .func);
        for (call.args, 0..) |argument, argument_index| {
            const target = if (function) |function_type|
                (if (argument_index < function_type.params.len) function_type.params[argument_index].qt else argument.qt(store.tree))
            else
                argument.qt(store.tree);
            try store.addChild(id, try store.serializeConverted(argument, "argument", target, false));
        }
        return id;
    }

    fn serializeConditional(store: *Store, conditional: aro.Tree.Node.Conditional) anyerror!u32 {
        _ = try store.types.intern(conditional.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "conditional",
            .token = conditional.cond_tok,
            .qt = conditional.qt,
            .value_category = "rvalue",
            .operator = "?:",
        });
        try store.addChild(id, try store.serializeExpression(conditional.cond));
        try store.addChild(id, try store.serializeExpression(conditional.then_expr));
        try store.addChild(id, try store.serializeExpression(conditional.else_expr));
        return id;
    }

    fn serializeTypeInfo(store: *Store, info: aro.Tree.Node.TypeInfo, kind: []const u8) !u32 {
        _ = try store.types.intern(info.qt);
        _ = try store.types.intern(info.operand_qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = kind,
            .token = info.op_tok,
            .qt = info.qt,
            .value_category = "rvalue",
            .target_qt = info.operand_qt,
            .type_info_value = if (std.mem.eql(u8, kind, "sizeof"))
                info.operand_qt.sizeof(store.tree.comp)
            else
                info.operand_qt.alignof(store.tree.comp),
        });
        if (info.expr) |expr| try store.addChild(id, try store.serializeExpression(expr));
        return id;
    }

    fn serializeCast(store: *Store, cast: aro.Tree.Node.Cast) anyerror!u32 {
        _ = try store.types.intern(cast.qt);
        if (!cast.implicit) {
            const id = try store.addRecord(.{
                .category = .expression,
                .kind = "unary",
                .token = cast.l_paren,
                .qt = cast.qt,
                .value_category = "rvalue",
                .operator = "cast",
            });
            try store.addChild(id, try store.serializeExpression(cast.operand));
            return id;
        }
        const conversion = store.castConversionName(
            cast.kind,
            cast.operand.qt(store.tree),
            cast.qt,
            store.tree.comp,
        );
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "conversion",
            .token = cast.l_paren,
            .qt = cast.qt,
            .value_category = "rvalue",
            .target_qt = cast.qt,
            .conversion = conversion,
        });
        try store.addChild(id, try store.serializeExpression(cast.operand));
        return id;
    }

    fn castConversionName(
        _: *const Store,
        kind: aro.Tree.Node.Cast.Kind,
        source: aro.QualType,
        target: aro.QualType,
        comp: *const aro.Compilation,
    ) []const u8 {
        if (isIntegerPromotion(source, target, comp)) return "integer-promotion";
        return switch (kind) {
            .no_op => "no-op",
            .bitcast => "bitcast",
            .array_to_pointer => "array-to-pointer",
            .lval_to_rval => "lvalue-to-rvalue",
            .function_to_pointer => "function-to-pointer",
            .pointer_to_bool => "pointer-to-bool",
            .pointer_to_int => "pointer-to-int",
            .bool_to_int => "bool-to-int",
            .bool_to_float => "bool-to-float",
            .bool_to_pointer => "bool-to-pointer",
            .int_to_bool => "int-to-bool",
            .int_to_float => "int-to-float",
            .complex_int_to_complex_float => "complex-int-to-complex-float",
            .int_to_pointer => "int-to-pointer",
            .float_to_bool => "float-to-bool",
            .float_to_int => "float-to-int",
            .complex_float_to_complex_int => "complex-float-to-complex-int",
            .int_cast => "int-cast",
            .complex_int_cast => "complex-int-cast",
            .complex_int_to_real => "complex-int-to-real",
            .real_to_complex_int => "real-to-complex-int",
            .float_cast => "float-cast",
            .complex_float_cast => "complex-float-cast",
            .complex_float_to_real => "complex-float-to-real",
            .real_to_complex_float => "real-to-complex-float",
            .to_void => "to-void",
            .null_to_pointer => "null-to-pointer",
            .union_cast => "union-cast",
            .vector_splat => "vector-splat",
            .atomic_to_non_atomic => "atomic-to-non-atomic",
            .non_atomic_to_atomic => "non-atomic-to-atomic",
        };
    }

    fn serializeConverted(store: *Store, node: aro.Tree.Node.Index, conversion: []const u8, target_qt: aro.QualType, preserve_promotion: bool) anyerror!u32 {
        _ = try store.types.intern(target_qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "conversion",
            .token = node.tok(store.tree),
            .qt = target_qt,
            .value_category = "rvalue",
            .target_qt = target_qt,
            .conversion = conversion,
        });
        const operand = switch (node.get(store.tree)) {
            .cast => |cast| if (cast.implicit and
                ((isBoundaryCast(cast.kind) and !isIntegerPromotion(cast.operand.qt(store.tree), cast.qt, store.tree.comp)) or
                    (!preserve_promotion and isIntegerPromotion(cast.operand.qt(store.tree), cast.qt, store.tree.comp))))
                cast.operand
            else
                node,
            else => node,
        };
        const child = if (store.needsLvalueLoad(operand, conversion, target_qt))
            try store.serializeConverted(operand, "lvalue-to-rvalue", operand.qt(store.tree), false)
        else switch (operand.get(store.tree)) {
            .array_init_expr, .struct_init_expr, .union_init_expr => try store.serializeAggregateInitializer(operand, target_qt),
            else => try store.serializeExpression(operand),
        };
        try store.addChild(id, child);
        return id;
    }

    fn serializeAggregateInitializer(store: *Store, node: aro.Tree.Node.Index, target_qt: aro.QualType) anyerror!u32 {
        _ = try store.types.intern(target_qt);
        const token = switch (node.get(store.tree)) {
            .array_init_expr => |initializer| initializer.l_brace_tok,
            .struct_init_expr => |initializer| initializer.l_brace_tok,
            .union_init_expr => |initializer| initializer.l_brace_tok,
            else => return error.UnsupportedInitializer,
        };
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "compound-literal",
            .token = token,
            .qt = target_qt,
            .value_category = "lvalue",
            .target_qt = target_qt,
        });
        try store.addInitializerChildren(id, node);
        return id;
    }

    fn needsLvalueLoad(store: *const Store, node: aro.Tree.Node.Index, conversion: []const u8, target_qt: aro.QualType) bool {
        if (std.mem.eql(u8, conversion, "lvalue-to-rvalue")) return false;
        if (std.mem.eql(u8, conversion, "assignment") and isAggregate(target_qt, store.tree.comp)) return false;
        return store.semanticLvalue(node);
    }

    fn semanticLvalue(store: *const Store, node: aro.Tree.Node.Index) bool {
        return switch (node.get(store.tree)) {
            .generic_expr => |generic| switch (generic.chosen.get(store.tree)) {
                .generic_association_expr => |association| store.semanticLvalue(association.expr),
                .generic_default_expr => |default| store.semanticLvalue(default.expr),
                else => false,
            },
            .paren_expr => |unary| store.semanticLvalue(unary.operand),
            .cast => |cast| cast.kind == .no_op and store.semanticLvalue(cast.operand),
            else => store.tree.isLval(node),
        };
    }

    fn serializeCompoundLiteral(store: *Store, literal: aro.Tree.Node.CompoundLiteral) anyerror!u32 {
        _ = try store.types.intern(literal.qt);
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "compound-literal",
            .token = literal.l_paren_tok,
            .qt = literal.qt,
            .value_category = "lvalue",
            .target_qt = literal.qt,
        });
        try store.addInitializerChildren(id, literal.initializer);
        return id;
    }

    fn serializeGeneric(store: *Store, generic: aro.Tree.Node.Generic) anyerror!u32 {
        _ = try store.types.intern(generic.qt);
        const child = switch (generic.chosen.get(store.tree)) {
            .generic_association_expr => |association| association.expr,
            .generic_default_expr => |default| default.expr,
            else => return error.UnknownAroNode,
        };
        const id = try store.addRecord(.{
            .category = .expression,
            .kind = "generic-selection",
            .token = generic.generic_tok,
            .qt = generic.qt,
            .value_category = store.valueCategory(child, generic.qt),
            .member_index = store.genericMemberIndex(generic),
        });
        try store.addChild(id, try store.serializeExpression(child));
        return id;
    }

    fn genericMemberIndex(store: *const Store, generic: aro.Tree.Node.Generic) u32 {
        const chosen_token = generic.chosen.tok(store.tree);
        var index: u32 = 0;
        for (generic.rest) |item| {
            if (item.tok(store.tree) < chosen_token) index += 1;
        }
        return index;
    }

    fn addInitializerChildren(store: *Store, parent: u32, initializer: aro.Tree.Node.Index) anyerror!void {
        switch (initializer.get(store.tree)) {
            .array_init_expr, .struct_init_expr => |container| {
                var index: u32 = 0;
                for (container.items) |item| {
                    switch (item.get(store.tree)) {
                        .array_filler_expr => |filler| {
                            index += @intCast(filler.count);
                            continue;
                        },
                        .default_init_expr => {},
                        else => try store.addInitializerChild(parent, index, item),
                    }
                    index += 1;
                }
            },
            .union_init_expr => |union_init| if (union_init.initializer) |item| {
                try store.addInitializerChild(parent, union_init.field_index, item);
            },
            else => try store.addInitializerChild(parent, 0, initializer),
        }
    }

    fn addInitializerChild(store: *Store, parent: u32, index: u32, item: aro.Tree.Node.Index) anyerror!void {
        try store.addChild(parent, try store.serializeInitializerValue(item));
        try store.records.items[parent - 1].initializer_indices.append(store.allocator, index);
    }

    fn serializeInitializerValue(store: *Store, node: aro.Tree.Node.Index) anyerror!u32 {
        return switch (node.get(store.tree)) {
            .array_init_expr, .struct_init_expr => |initializer| store.serializeAggregateInitializer(
                node,
                initializer.container_qt,
            ),
            .union_init_expr => |initializer| store.serializeAggregateInitializer(
                node,
                initializer.union_qt,
            ),
            else => store.serializeExpression(node),
        };
    }

    fn symbolId(store: *const Store, node: aro.Tree.Node.Index) !u32 {
        return store.symbols.resolver().idForNode(@backingInt(node)) orelse error.MissingSymbol;
    }

    fn valueCategory(store: *const Store, node: aro.Tree.Node.Index, qt: aro.QualType) []const u8 {
        if (qt.get(store.tree.comp, .func) != null) return "function";
        return if (store.tree.isLval(node)) "lvalue" else "rvalue";
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
        try output.add("{\"id\":");
        try output.integer(id);
        try output.add(",\"category\":");
        try output.string(@tagName(record.category));
        try output.add(",\"kind\":");
        try output.string(record.kind);
        try store.writeLocationFields(output, record.token);
        if (record.category == .expression) {
            try output.add(",\"type\":");
            try output.integer(try store.types.intern(record.qt));
            try output.add(",\"valueCategory\":");
            try output.string(record.value_category orelse return error.MissingValueCategory);
        } else if (record.category == .declaration and !std.mem.eql(u8, record.kind, "static-assert")) {
            try output.add(",\"type\":");
            if (std.mem.eql(u8, record.kind, "typedef-declaration")) {
                const declaration_node = record.declaration_node orelse return error.UnsupportedType;
                try output.integer(store.types.by_typedef.get(declaration_node) orelse return error.UnsupportedType);
            } else {
                try output.integer(try store.types.intern(record.qt));
            }
            try output.add(",\"symbol\":");
            try output.integer(record.symbol orelse return error.MissingSymbol);
        }
        try output.add(",\"children\":[");
        for (record.children.items, 0..) |child, child_index| {
            if (child_index != 0) try output.byte(',');
            try output.integer(child);
        }
        try output.byte(']');
        if (record.operator) |operator| {
            try output.add(",\"operator\":");
            try output.string(operator);
        }
        if (record.for_clause_mask) |mask| {
            try output.add(",\"forClauseMask\":");
            try output.integer(mask);
        }
        if (record.label) |label| {
            try output.add(",\"label\":");
            try output.string(label);
        }
        if (record.member_index) |member_index| {
            try output.add(",\"memberIndex\":");
            try output.integer(member_index);
        }
        if (record.target_qt) |target_qt| {
            try output.add(",\"targetType\":");
            try output.integer(try store.types.intern(target_qt));
        }
        if (record.computation_qt) |computation_qt| {
            try output.add(",\"computationType\":");
            try output.integer(try store.types.intern(computation_qt));
        }
        if (std.mem.eql(u8, record.kind, "compound-literal")) {
            try output.add(",\"initializerIndices\":[");
            for (record.initializer_indices.items, 0..) |initializer_index, index| {
                if (index != 0) try output.byte(',');
                try output.integer(initializer_index);
            }
            try output.byte(']');
        }
        if (record.conversion) |conversion| {
            try output.add(",\"conversion\":");
            try output.string(conversion);
        }
        if (record.category == .expression and std.mem.eql(u8, record.kind, "declaration-reference")) {
            try output.add(",\"symbol\":");
            try output.integer(record.symbol orelse return error.MissingSymbol);
        }
        if (record.constant_node) |constant_node| {
            const value = store.tree.value_map.get(constant_node) orelse return error.UnsupportedValue;
            try output.add(",\"constant\":");
            try serialize_values.writeConstant(output, value, record.qt, store.types, store.symbols.resolver(), constant_node);
        }
        if (record.type_info_value) |value| {
            try output.add(",\"constant\":{\"kind\":\"integer\",\"bits\":");
            try output.integer(record.qt.bitSizeof(store.tree.comp));
            try output.add(",\"signed\":");
            try output.add(if (record.qt.signedness(store.tree.comp) == .signed) "true" else "false");
            try output.add(",\"value\":\"");
            try output.integer(value);
            try output.add("\"}");
        }
        if (record.case_value_node) |case_node| {
            const value = store.tree.value_map.get(case_node) orelse return error.NonConstantCase;
            const qt = case_node.qt(store.tree);
            try output.add(",\"caseValue\":");
            try serialize_values.writeConstant(output, value, qt, store.types, store.symbols.resolver(), case_node);
        }
        try output.byte('}');
    }

    fn writeLocationFields(store: *const Store, output: anytype, token: aro.Tree.TokenIndex) !void {
        const spelling_loc = store.tree.tokens.items(.loc)[token];
        const spelling_len: u32 = @intCast(store.tree.tokSlice(token).len);
        const expansions = if (store.preprocessor) |pp| pp.expansionSlice(token) else &.{};
        const primary_loc = if (expansions.len == 0) spelling_loc else expansions[expansions.len - 1];
        const primary_len = if (expansions.len == 0) spelling_len else store.sourceTokenLength(primary_loc, spelling_len);
        const primary = try store.resolveRange(primary_loc, primary_len);
        try output.add(",\"range\":");
        try writeRange(output, primary);
        if (spelling_loc.id.index != .generated and store.types.sources.fileForAroId(spelling_loc.id) != null) {
            const spelling = try store.resolveRange(spelling_loc, spelling_len);
            if (!Range.eql(primary, spelling)) {
                try output.add(",\"spellingRange\":");
                try writeRange(output, spelling);
            }
        }
    }

    fn resolveRange(store: *const Store, loc: aro.Source.Location, len: u32) !Range {
        const source = store.tree.comp.getSource(loc.id);
        const file = store.types.sources.fileForAroId(loc.id) orelse return error.InvalidSourceMapping;
        var mapper = aro.Source.OriginalLocationMapper.init(source, file.source);
        const start = (try mapper.resolve(loc.byte_offset)).after_splice;
        const end_boundary = try mapper.resolve(loc.byte_offset + len);
        const end = if (len == 0) end_boundary.after_splice else end_boundary.before_splice;
        return .{ .file = file.id, .start = start, .end = end };
    }

    fn sourceTokenLength(store: *const Store, loc: aro.Source.Location, fallback: u32) u32 {
        const source = store.tree.comp.getSource(loc.id);
        if (loc.byte_offset >= source.buf.len) return fallback;
        var tokenizer: aro.Tokenizer = .{
            .buf = source.buf, .source = source.id, .index = loc.byte_offset,
            .langopts = store.tree.comp.langopts, .splice_locs = source.splice_locs,
        };
        const token = tokenizer.next();
        return token.end - token.start;
    }

    pub fn writeDeclarations(store: *Store, output: anytype) !void {
        try output.byte('[');
        for (store.declarations.items, 0..) |declaration, index| {
            if (index != 0) try output.byte(',');
            try output.integer(declaration);
        }
        try output.byte(']');
    }
};

fn isPointer(qt: aro.QualType, comp: *const aro.Compilation) bool {
    return qt.get(comp, .pointer) != null;
}

fn isAggregate(qt: aro.QualType, comp: *const aro.Compilation) bool {
    return qt.get(comp, .array) != null or qt.get(comp, .@"struct") != null or qt.get(comp, .@"union") != null;
}

fn isIntegerPromotion(source: aro.QualType, target: aro.QualType, comp: *const aro.Compilation) bool {
    if (source.get(comp, .int) == null and !source.is(comp, .bool) and source.get(comp, .@"enum") == null) return false;
    if (target.get(comp, .int) == null and !target.is(comp, .bool) and target.get(comp, .@"enum") == null) return false;
    return target.bitSizeof(comp) == aro.QualType.int.bitSizeof(comp) and source.bitSizeof(comp) < target.bitSizeof(comp);
}

fn isBoundaryCast(kind: aro.Tree.Node.Cast.Kind) bool {
    return switch (kind) {
        .lval_to_rval, .array_to_pointer, .function_to_pointer => false,
        else => true,
    };
}

fn writeRange(output: anytype, range: Range) !void {
    try output.add("{\"file\":");
    try output.integer(range.file);
    try output.add(",\"start\":");
    try writePosition(output, range.start);
    try output.add(",\"end\":");
    try writePosition(output, range.end);
    try output.byte('}');
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
