const std = @import("std");
const aro = @import("aro");
const serializer = @import("serializer");

const fixture = @embedFile("fixtures/control-and-expressions.c");

test "node golden serializes C17 control expressions conversions and macro locations" {
    var sources = serializer.SourceState.init(std.testing.allocator, .{
        .file_bytes = 4 * 1024 * 1024,
        .total_source_bytes = 32 * 1024 * 1024,
        .file_count = 4096,
        .include_depth = 32,
        .request_bytes = 40 * 1024 * 1024,
        .result_bytes = 64 * 1024 * 1024,
        .memory_bytes = 128 * 1024 * 1024,
    });
    defer sources.deinit();
    try sources.recordMain("control-and-expressions.c", fixture);

    var aro_diagnostics: aro.Diagnostics = .{
        .output = .{ .to_list = .{ .arena = .init(std.testing.allocator) } },
    };
    defer aro_diagnostics.deinit();
    var comp = try aro.Compilation.init(.{
        .gpa = std.testing.allocator,
        .arena = std.testing.allocator,
        .io = std.Io.failing,
        .diagnostics = &aro_diagnostics,
        .environ_map = null,
        .data_model = .merc32,
        .source_provider = null,
        .max_include_depth = 32,
        .add_default_pragma_handlers = false,
    });
    defer comp.deinit();
    comp.langopts.standard = .c17;
    try comp.initSearchPath(&.{}, false);

    const main_source = try comp.addSourceFromBuffer("control-and-expressions.c", fixture);
    try sources.bindMain(main_source);
    const builtin_source = try comp.generateBuiltinMacros(.include_system_defines);
    var pp = try aro.Preprocessor.init(&comp, .{
        .base_file = main_source.id,
        .source_epoch = .default,
    });
    defer pp.deinit();
    try pp.preprocessSources(.{
        .main = main_source,
        .builtin = builtin_source,
        .command_line = null,
    });
    var tree = try aro.Parser.parse(&pp);
    defer tree.deinit();
    try std.testing.expectEqual(@as(u32, 0), aro_diagnostics.errors);
    const encoded = if (@hasDecl(serializer, "envelopeWithPreprocessor"))
        try serializer.envelopeWithPreprocessor(
            std.testing.allocator,
            64 * 1024 * 1024,
            "test-build",
            .ok,
            &.{},
            &sources,
            &tree,
            &pp,
        )
    else
        try serializer.envelope(
            std.testing.allocator,
            64 * 1024 * 1024,
            "test-build",
            .ok,
            &.{},
            &sources,
            &tree,
        );
    defer std.testing.allocator.free(encoded);
    const repeated = if (@hasDecl(serializer, "envelopeWithPreprocessor"))
        try serializer.envelopeWithPreprocessor(
            std.testing.allocator,
            64 * 1024 * 1024,
            "test-build",
            .ok,
            &.{},
            &sources,
            &tree,
            &pp,
        )
    else
        try serializer.envelope(
            std.testing.allocator,
            64 * 1024 * 1024,
            "test-build",
            .ok,
            &.{},
            &sources,
            &tree,
        );
    defer std.testing.allocator.free(repeated);
    try std.testing.expectEqualStrings(encoded, repeated);

    var parsed = try std.json.parseFromSlice(std.json.Value, std.testing.allocator, encoded, .{});
    defer parsed.deinit();
    const unit = objectField(parsed.value.object, "unit");
    const nodes = arrayField(unit, "nodes");
    try std.testing.expect(nodes.items.len != 0);

    try expectKinds(nodes, &.{
        "function-definition",  "parameter-declaration", "compound",              "declaration-statement",
        "expression-statement", "return",                "if",                    "while",
        "do-while",             "for",                   "switch",                "case",
        "default",              "break",                 "continue",              "goto",
        "label",                "empty",                 "integer-literal",       "floating-literal",
        "character-literal",    "string-literal",        "declaration-reference", "unary",
        "binary",               "conditional",           "assignment",            "call",
        "subscript",            "member",                "sizeof",                "alignof",
        "conversion",           "compound-literal",      "generic-selection",
    });
    try expectOperators(nodes, "unary", &.{ "pre++", "post--", "post++", "pre--", "*", "&" });
    try expectOperators(nodes, "binary", &.{ "+", "-", "<", ">", "==", "&&", "||" });
    try expectOperators(nodes, "assignment", &.{ "=", "+=" });
    try expectConversions(nodes, &.{
        "lvalue-to-rvalue", "array-to-pointer", "function-to-pointer", "integer-promotion",
        "usual-arithmetic", "assignment",       "argument",            "return",
    });
    try expectCallChildOrder(nodes, arrayField(unit, "symbols"));
    try expectConditionalChildOrder(nodes);
    try expectControlChildOrder(nodes);
    try expectCaseConstant(nodes);
    try expectGenericSelection(nodes);
    try expectMemberValueCategories(nodes);
    try expectPointerConversions(nodes);
    try expectAutomaticAggregateInitializers(nodes);
    try expectNestedAutomaticAggregateInitializers(nodes);
    try expectLocalFunctionLink(nodes, arrayField(unit, "symbols"));
    try expectUnnamedPrototype(unit, nodes, arrayField(unit, "symbols"));
    try expectGenericValueContext(nodes);
    const symbols = arrayField(unit, "symbols");
    try expectLocalSymbols(symbols);
    try expectNormalizedStaticDeclaration(nodes, symbols);
    try expectNestedMacroRanges(nodes);
    try expectPreorderIds(nodes);
    try expectDistinctSpellingRanges(nodes);

    const declarations = arrayField(unit, "declarations");
    try std.testing.expect(declarations.items.len >= 4);
    for (declarations.items) |declaration_id| {
        const node = findId(nodes, declaration_id.integer);
        try expectString(node, "category", "declaration");
    }
}

fn expectPointerConversions(nodes: std.json.Array) !void {
    const conversion = findString(nodes, "conversion", "int-to-pointer") orelse return error.TestExpectedEqual;
    try expectString(conversion, "kind", "conversion");
}

fn expectAutomaticAggregateInitializers(nodes: std.json.Array) !void {
    var saw_array = false;
    var saw_struct = false;
    for (nodes.items) |value| {
        const node = value.object;
        if (!stringEquals(node, "kind", "compound-literal")) continue;
        const target = node.get("targetType") orelse continue;
        _ = target;
        saw_array = saw_array or arrayField(node, "children").items.len == 3;
        saw_struct = saw_struct or arrayField(node, "children").items.len == 2;
    }
    try std.testing.expect(saw_array and saw_struct);
}

fn expectNestedAutomaticAggregateInitializers(nodes: std.json.Array) !void {
    var saw_nested = false;
    for (nodes.items) |value| {
        const node = value.object;
        if (!stringEquals(node, "kind", "compound-literal")) continue;
        for (arrayField(node, "children").items) |child| {
            if (stringEquals(findId(nodes, child.integer), "kind", "compound-literal")) {
                saw_nested = true;
            }
        }
    }
    try std.testing.expect(saw_nested);
}

fn expectLocalFunctionLink(nodes: std.json.Array, symbols: std.json.Array) !void {
    const helper = findString(symbols, "name", "later_helper") orelse return error.TestExpectedEqual;
    try expectString(helper, "kind", "function");
    try std.testing.expect(boolField(helper, "definition"));
    var saw_local_declaration = false;
    for (nodes.items) |value| {
        const node = value.object;
        if (stringEquals(node, "kind", "function-declaration") and integerField(node, "symbol") == integerField(helper, "id")) {
            saw_local_declaration = true;
        }
    }
    try std.testing.expect(saw_local_declaration);
}

fn expectUnnamedPrototype(unit: std.json.ObjectMap, nodes: std.json.Array, symbols: std.json.Array) !void {
    const symbol = findString(symbols, "name", "unnamed_prototype") orelse return error.TestExpectedEqual;
    try expectString(symbol, "kind", "function");
    const symbol_id = integerField(symbol, "id");
    var declaration: ?std.json.ObjectMap = null;
    for (nodes.items) |value| {
        const node = value.object;
        if (stringEquals(node, "kind", "function-declaration") and integerField(node, "symbol") == symbol_id) {
            declaration = node;
            break;
        }
    }
    try std.testing.expect(declaration != null);
    try std.testing.expectEqual(@as(usize, 0), arrayField(declaration.?, "children").items.len);
    const function_type = findId(arrayField(unit, "types"), integerField(symbol, "type"));
    try expectString(function_type, "kind", "function");
    try std.testing.expectEqual(@as(usize, 1), arrayField(function_type, "parameters").items.len);
}

fn expectGenericValueContext(nodes: std.json.Array) !void {
    var saw_load = false;
    for (nodes.items) |value| {
        const node = value.object;
        if (!stringEquals(node, "kind", "conversion") or !stringEquals(node, "conversion", "lvalue-to-rvalue")) continue;
        const child = findId(nodes, arrayField(node, "children").items[0].integer);
        if (findDescendantKind(nodes, child, "generic-selection")) |generic| {
            try expectString(generic, "valueCategory", "lvalue");
            saw_load = true;
        }
    }
    try std.testing.expect(saw_load);
}

fn expectGenericSelection(nodes: std.json.Array) !void {
    const generic = findString(nodes, "kind", "generic-selection") orelse return error.TestExpectedEqual;
    try std.testing.expectEqual(@as(i64, 1), integerField(generic, "memberIndex"));
    const chosen_id = arrayField(generic, "children").items[0].integer;
    const chosen = findId(nodes, chosen_id);
    try expectString(chosen, "valueCategory", "lvalue");
    try expectString(generic, "valueCategory", "lvalue");
}

fn expectMemberValueCategories(nodes: std.json.Array) !void {
    var saw_rvalue_dot = false;
    var saw_rvalue_arrow_base = false;
    for (nodes.items) |value| {
        const member = value.object;
        if (!stringEquals(member, "kind", "member")) continue;
        const child = findId(nodes, arrayField(member, "children").items[0].integer);
        if (findDescendantKind(nodes, child, "conditional") != null) {
            try expectString(child, "valueCategory", "rvalue");
            try expectString(member, "valueCategory", "rvalue");
            saw_rvalue_dot = true;
        }
        if (findDescendantOperator(nodes, child, "&") != null) {
            try std.testing.expect(!stringEquals(child, "kind", "conversion"));
            try expectString(child, "valueCategory", "rvalue");
            try expectString(member, "valueCategory", "lvalue");
            saw_rvalue_arrow_base = true;
        }
    }
    try std.testing.expect(saw_rvalue_dot and saw_rvalue_arrow_base);
}

fn expectLocalSymbols(symbols: std.json.Array) !void {
    try expectString(findString(symbols, "name", "LocalInt") orelse return error.TestExpectedEqual, "kind", "typedef");
    try expectString(findString(symbols, "name", "LocalPair") orelse return error.TestExpectedEqual, "kind", "record");
    try expectString(findString(symbols, "name", "LocalChoice") orelse return error.TestExpectedEqual, "kind", "enum");
    try expectString(findString(symbols, "name", "local_choice") orelse return error.TestExpectedEqual, "kind", "enumerator");
}

fn expectNormalizedStaticDeclaration(nodes: std.json.Array, symbols: std.json.Array) !void {
    const symbol = findString(symbols, "name", "global_pair") orelse return error.TestExpectedEqual;
    const symbol_id = integerField(symbol, "id");
    for (nodes.items) |value| {
        const node = value.object;
        if (stringEquals(node, "kind", "variable-declaration") and integerField(node, "symbol") == symbol_id) {
            try std.testing.expectEqual(@as(usize, 0), arrayField(node, "children").items.len);
            return;
        }
    }
    return error.TestExpectedEqual;
}

fn expectPreorderIds(nodes: std.json.Array) !void {
    for (nodes.items, 0..) |value, index| {
        const node = value.object;
        const id = integerField(node, "id");
        try std.testing.expectEqual(@as(i64, @intCast(index + 1)), id);
        for (arrayField(node, "children").items) |child| {
            try std.testing.expect(child.integer > id);
        }
    }
}

fn expectDistinctSpellingRanges(nodes: std.json.Array) !void {
    for (nodes.items) |value| {
        const node = value.object;
        const spelling = node.get("spellingRange") orelse continue;
        try std.testing.expect(!std.meta.eql(node.get("range").?, spelling));
    }
}

fn expectKinds(nodes: std.json.Array, expected: []const []const u8) !void {
    for (expected) |kind| {
        _ = findString(nodes, "kind", kind) orelse {
            std.debug.print("missing node kind {s}\n", .{kind});
            return error.TestExpectedEqual;
        };
    }
}

fn expectOperators(nodes: std.json.Array, kind: []const u8, expected: []const []const u8) !void {
    for (expected) |operator| {
        _ = findTwoStrings(nodes, "kind", kind, "operator", operator) orelse {
            std.debug.print("missing {s} operator {s}\n", .{ kind, operator });
            return error.TestExpectedEqual;
        };
    }
}

fn expectConversions(nodes: std.json.Array, expected: []const []const u8) !void {
    for (expected) |conversion| {
        const node = findString(nodes, "conversion", conversion) orelse {
            std.debug.print("missing conversion {s}\n", .{conversion});
            return error.TestExpectedEqual;
        };
        try expectString(node, "kind", "conversion");
        try expectString(node, "category", "expression");
        try std.testing.expect(node.get("type") != null);
        try std.testing.expect(node.get("targetType") != null);
        try std.testing.expectEqual(@as(usize, 1), arrayField(node, "children").items.len);
    }
}

fn expectCallChildOrder(nodes: std.json.Array, symbols: std.json.Array) !void {
    const direct_symbol = findNamedSymbol(symbols, "add");
    var saw_direct = false;
    var saw_indirect = false;
    for (nodes.items) |value| {
        const node = value.object;
        if (!stringEquals(node, "kind", "call")) continue;
        const children = arrayField(node, "children");
        try std.testing.expect(children.items.len >= 2);
        const callee_conversion = findId(nodes, children.items[0].integer);
        const callee_kind = stringField(callee_conversion, "conversion");
        try std.testing.expect(std.mem.eql(u8, callee_kind, "function-to-pointer") or std.mem.eql(u8, callee_kind, "lvalue-to-rvalue"));
        const callee = findDescendantKind(nodes, callee_conversion, "declaration-reference") orelse
            return error.TestExpectedEqual;
        const arguments = children.items[1..];
        for (arguments) |argument_id| {
            const argument = findId(nodes, argument_id.integer);
            try expectString(argument, "conversion", "argument");
        }
        const symbol = integerField(callee, "symbol");
        if (symbol == direct_symbol) {
            try std.testing.expectEqualStrings("function-to-pointer", callee_kind);
            saw_direct = true;
        } else if (std.mem.eql(u8, callee_kind, "lvalue-to-rvalue")) {
            try std.testing.expectEqualStrings("lvalue-to-rvalue", callee_kind);
            saw_indirect = true;
        }
    }
    try std.testing.expect(saw_direct and saw_indirect);
}

fn expectConditionalChildOrder(nodes: std.json.Array) !void {
    const conditional = findString(nodes, "kind", "conditional") orelse return error.TestExpectedEqual;
    const children = arrayField(conditional, "children");
    try std.testing.expectEqual(@as(usize, 3), children.items.len);
    try expectString(findId(nodes, children.items[0].integer), "conversion", "lvalue-to-rvalue");
}

fn expectControlChildOrder(nodes: std.json.Array) !void {
    const if_node = findString(nodes, "kind", "if") orelse return error.TestExpectedEqual;
    try std.testing.expectEqual(@as(usize, 3), arrayField(if_node, "children").items.len);
    const do_while = findString(nodes, "kind", "do-while") orelse return error.TestExpectedEqual;
    const do_children = arrayField(do_while, "children");
    try std.testing.expectEqual(@as(usize, 2), do_children.items.len);
    try expectString(findId(nodes, do_children.items[0].integer), "kind", "compound");
    const for_node = findString(nodes, "kind", "for") orelse return error.TestExpectedEqual;
    try std.testing.expectEqual(@as(usize, 4), arrayField(for_node, "children").items.len);
}

fn expectCaseConstant(nodes: std.json.Array) !void {
    const case_node = findString(nodes, "kind", "case") orelse return error.TestExpectedEqual;
    const value = objectField(case_node, "caseValue");
    try expectString(value, "kind", "integer");
}

fn expectNestedMacroRanges(nodes: std.json.Array) !void {
    const macro_add = findMacroBinary(nodes) orelse return error.TestExpectedEqual;
    const range = objectField(macro_add, "range");
    const spelling = objectField(macro_add, "spellingRange");
    try expectPosition(objectField(range, "start"), 53, 13, 1281);
    try expectPosition(objectField(range, "end"), 53, 22, 1290);
    try expectPosition(objectField(spelling, "start"), 1, 30, 29);
    try expectPosition(objectField(spelling, "end"), 1, 31, 30);
}

fn findMacroBinary(nodes: std.json.Array) ?std.json.ObjectMap {
    for (nodes.items) |value| {
        const node = value.object;
        if (stringEquals(node, "kind", "binary") and stringEquals(node, "operator", "+") and node.get("spellingRange") != null) {
            return node;
        }
    }
    return null;
}

fn findNamedSymbol(symbols: std.json.Array, name: []const u8) i64 {
    return integerField(findString(symbols, "name", name) orelse unreachable, "id");
}

fn expectPosition(position: std.json.ObjectMap, line: i64, column: i64, byte_offset: i64) !void {
    try std.testing.expectEqual(line, integerField(position, "line"));
    try std.testing.expectEqual(column, integerField(position, "column"));
    try std.testing.expectEqual(byte_offset, integerField(position, "byteOffset"));
}

fn findString(array: std.json.Array, field: []const u8, value: []const u8) ?std.json.ObjectMap {
    for (array.items) |item| if (stringEquals(item.object, field, value)) return item.object;
    return null;
}

fn findTwoStrings(
    array: std.json.Array,
    first_field: []const u8,
    first_value: []const u8,
    second_field: []const u8,
    second_value: []const u8,
) ?std.json.ObjectMap {
    for (array.items) |item| {
        if (stringEquals(item.object, first_field, first_value) and stringEquals(item.object, second_field, second_value)) return item.object;
    }
    return null;
}

fn findId(array: std.json.Array, id: i64) std.json.ObjectMap {
    for (array.items) |item| if (integerField(item.object, "id") == id) return item.object;
    unreachable;
}

fn findDescendantKind(nodes: std.json.Array, root: std.json.ObjectMap, kind: []const u8) ?std.json.ObjectMap {
    if (stringEquals(root, "kind", kind)) return root;
    for (arrayField(root, "children").items) |child| {
        if (findDescendantKind(nodes, findId(nodes, child.integer), kind)) |found| return found;
    }
    return null;
}

fn findDescendantOperator(nodes: std.json.Array, root: std.json.ObjectMap, operator: []const u8) ?std.json.ObjectMap {
    if (stringEquals(root, "operator", operator)) return root;
    for (arrayField(root, "children").items) |child| {
        if (findDescendantOperator(nodes, findId(nodes, child.integer), operator)) |found| return found;
    }
    return null;
}

fn objectField(object: std.json.ObjectMap, field: []const u8) std.json.ObjectMap {
    return object.get(field).?.object;
}

fn arrayField(object: std.json.ObjectMap, field: []const u8) std.json.Array {
    return object.get(field).?.array;
}

fn stringEquals(object: std.json.ObjectMap, field: []const u8, expected: []const u8) bool {
    const value = object.get(field) orelse return false;
    return value == .string and std.mem.eql(u8, value.string, expected);
}

fn expectString(object: std.json.ObjectMap, field: []const u8, expected: []const u8) !void {
    try std.testing.expect(stringEquals(object, field, expected));
}

fn integerField(object: std.json.ObjectMap, field: []const u8) i64 {
    return object.get(field).?.integer;
}

fn boolField(object: std.json.ObjectMap, field: []const u8) bool {
    return object.get(field).?.bool;
}

fn stringField(object: std.json.ObjectMap, field: []const u8) []const u8 {
    return object.get(field).?.string;
}
