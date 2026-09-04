const std = @import("std");
const aro = @import("aro");
const serializer = @import("serializer");

const fixture = @embedFile("fixtures/types-and-initializers.c");

test "semantic golden serializes MERC32 types symbols exact constants and normalized initializers" {
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
    try sources.recordMain("types-and-initializers.c", fixture);

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

    const main_source = try comp.addSourceFromBuffer("types-and-initializers.c", fixture);
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

    const encoded = try serializer.envelope(
        std.testing.allocator,
        64 * 1024 * 1024,
        "test-build",
        .ok,
        &.{},
        &sources,
        &tree,
    );
    defer std.testing.allocator.free(encoded);
    const repeated = try serializer.envelope(
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
    const types = arrayField(unit, "types");
    const symbols = arrayField(unit, "symbols");

    const qualified_word_type = findNamed(types, "typedef", "QualifiedWord");
    try expectStrings(stringArrayField(qualified_word_type, "qualifiers"), &.{"const"});
    const qualified_word_target = findId(types, integerField(qualified_word_type, "target"));
    try expectString(qualified_word_target, "kind", "builtin");
    try expectString(qualified_word_target, "name", "unsigned long");

    const qualified_pointer_type = findNamed(types, "typedef", "QualifiedPointer");
    try expectStrings(stringArrayField(qualified_pointer_type, "qualifiers"), &.{ "const", "volatile", "restrict" });
    const matrix_row_type = findNamed(types, "typedef", "MatrixRow");
    const matrix_array = findId(types, integerField(matrix_row_type, "target"));
    try expectString(matrix_array, "kind", "array");
    try std.testing.expectEqual(@as(i64, 3), integerField(matrix_array, "count"));

    const operation_type = findNamed(types, "typedef", "BinaryOperation");
    const function_type = findId(types, integerField(operation_type, "target"));
    try expectString(function_type, "kind", "function");
    try std.testing.expectEqual(@as(i64, 0), integerField(function_type, "size"));
    try std.testing.expectEqual(@as(i64, 4), integerField(function_type, "alignment"));
    try std.testing.expectEqual(@as(usize, 2), arrayField(function_type, "parameters").items.len);
    try std.testing.expect(!boolField(function_type, "variadic"));

    const outer = findNamed(types, "struct", "Outer");
    try std.testing.expectEqual(@as(i64, 36), integerField(outer, "size"));
    const outer_members = arrayField(outer, "members");
    try expectMember(outer_members, "choice", 0);
    try expectMember(outer_members, "payload", 4);
    try expectMember(outer_members, "rows", 12);
    const payload = findNamed(types, "union", "Payload");
    try expectMember(arrayField(payload, "members"), "word", 0);
    try expectMember(arrayField(payload, "members"), "inner", 0);

    const enumeration = findNamed(types, "enum", "SignedChoice");
    const enum_values = arrayField(enumeration, "enumerators");
    try expectString(findNamedOnly(enum_values, "CHOICE_NEGATIVE"), "value", "-7");
    try expectString(findNamedOnly(enum_values, "CHOICE_LARGE"), "value", "2147483647");
    const bit_fields = arrayField(findNamed(types, "struct", "BitFields"), "members");
    const low = findNamedOnly(bit_fields, "low");
    const high = findNamedOnly(bit_fields, "high");
    try std.testing.expectEqual(@as(i64, 0), integerField(low, "bitOffset"));
    try std.testing.expectEqual(@as(i64, 3), integerField(low, "bitWidth"));
    try std.testing.expectEqual(@as(i64, 3), integerField(high, "bitOffset"));
    try std.testing.expectEqual(@as(i64, 5), integerField(high, "bitWidth"));
    try std.testing.expectEqual(@as(usize, 0), initializerWrites(findNamedOnly(symbols, "zero_bits")).items.len);

    const atomic = findId(types, integerField(findNamedOnly(symbols, "atomic_word"), "type"));
    try expectStrings(stringArrayField(atomic, "qualifiers"), &.{"atomic"});

    try expectIntegerInitializer(findNamedOnly(symbols, "signed_min"), 0, 64, true, "-9223372036854775808");
    try expectIntegerInitializer(findNamedOnly(symbols, "unsigned_max"), 0, 64, false, "18446744073709551615");
    try expectFloatingInitializer(findNamedOnly(symbols, "exact_float"), "3fc00000");
    try expectFloatingInitializer(findNamedOnly(symbols, "exact_double"), "c002000000000000");
    try expectFloatingInitializer(findNamedOnly(symbols, "exact_long_double"), "4008000000000000");
    const string_value = objectField(firstWrite(findNamedOnly(symbols, "embedded_nul")), "value");
    try expectIntegers(arrayField(string_value, "bytes"), &.{ 65, 0, 66, 0 });
    const literal_pointer = objectField(firstWrite(findNamedOnly(symbols, "literal_pointer")), "value");
    const literal_backing = findId(symbols, integerField(literal_pointer, "symbol"));
    try std.testing.expect(std.mem.startsWith(u8, stringField(literal_backing, "name"), ".L.str."));
    try expectString(literal_backing, "linkage", "internal");
    const literal_bytes = objectField(firstWrite(literal_backing), "value");
    try expectIntegers(arrayField(literal_bytes, "bytes"), &.{ 67, 0 });
    try std.testing.expectEqual(@as(usize, 1), countStringBackingSymbols(symbols));

    const base = findNamedOnly(symbols, "address_base");
    const positive = objectField(firstWrite(findNamedOnly(symbols, "object_address_positive")), "value");
    const negative = objectField(firstWrite(findNamedOnly(symbols, "object_address_negative")), "value");
    try std.testing.expectEqual(integerField(base, "id"), integerField(positive, "symbol"));
    try std.testing.expectEqual(integerField(base, "id"), integerField(negative, "symbol"));
    try expectString(positive, "addend", "12");
    try expectString(negative, "addend", "-4");
    try std.testing.expectEqual(
        integerField(findNamedOnly(symbols, "object_address_positive"), "type"),
        integerField(findNamedOnly(symbols, "object_address_negative"), "type"),
    );

    const add_symbol = findNamedOnly(symbols, "add");
    try std.testing.expectEqual(integerField(function_type, "id"), integerField(add_symbol, "type"));
    const function_address = objectField(firstWrite(findNamedOnly(symbols, "function_address")), "value");
    try std.testing.expectEqual(integerField(add_symbol, "id"), integerField(function_address, "symbol"));
    try expectString(function_address, "addend", "0");

    const partial_writes = initializerWrites(findNamedOnly(symbols, "partial"));
    try std.testing.expectEqual(@as(usize, 2), partial_writes.items.len);
    try expectWrite(partial_writes.items[0].object, 8, "42");
    try expectWrite(partial_writes.items[1].object, 32, "-5");
    const union_writes = initializerWrites(findNamedOnly(symbols, "selected_union"));
    try std.testing.expectEqual(@as(usize, 2), union_writes.items.len);
    try expectWrite(union_writes.items[0].object, 0, "90");
    try expectWrite(union_writes.items[1].object, 4, "17");
    try std.testing.expectEqual(@as(usize, 0), initializerWrites(findNamedOnly(symbols, "zero_initialized")).items.len);
    try std.testing.expect(boolField(objectField(findNamedOnly(symbols, "zero_initialized"), "initializer"), "zeroFill"));
    try std.testing.expect(std.mem.indexOf(u8, encoded, "\"tag\":") == null);
    try std.testing.expect(std.mem.indexOf(u8, encoded, "\"value\":\"-0\"") == null);
}

fn findNamed(array: std.json.Array, kind: []const u8, name: []const u8) std.json.ObjectMap {
    for (array.items) |item| {
        const object = item.object;
        if (std.mem.eql(u8, stringField(object, "kind"), kind) and
            std.mem.eql(u8, stringField(object, "name"), name)) return object;
    }
    unreachable;
}

fn findNamedOnly(array: std.json.Array, name: []const u8) std.json.ObjectMap {
    for (array.items) |item| {
        const object = item.object;
        if (object.get("name")) |value| if (std.mem.eql(u8, value.string, name)) return object;
    }
    unreachable;
}

fn findId(array: std.json.Array, id: i64) std.json.ObjectMap {
    for (array.items) |item| if (integerField(item.object, "id") == id) return item.object;
    unreachable;
}

fn countStringBackingSymbols(symbols: std.json.Array) usize {
    var count: usize = 0;
    for (symbols.items) |item| {
        const object = item.object;
        const name = object.get("name") orelse continue;
        if (std.mem.startsWith(u8, name.string, ".L.str.")) count += 1;
    }
    return count;
}

fn objectField(object: std.json.ObjectMap, name: []const u8) std.json.ObjectMap {
    return object.get(name).?.object;
}

fn arrayField(object: std.json.ObjectMap, name: []const u8) std.json.Array {
    return object.get(name).?.array;
}

fn stringArrayField(object: std.json.ObjectMap, name: []const u8) std.json.Array {
    return arrayField(object, name);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) []const u8 {
    return object.get(name).?.string;
}

fn integerField(object: std.json.ObjectMap, name: []const u8) i64 {
    return object.get(name).?.integer;
}

fn boolField(object: std.json.ObjectMap, name: []const u8) bool {
    return object.get(name).?.bool;
}

fn expectString(object: std.json.ObjectMap, name: []const u8, expected: []const u8) !void {
    try std.testing.expectEqualStrings(expected, stringField(object, name));
}

fn expectStrings(actual: std.json.Array, expected: []const []const u8) !void {
    try std.testing.expectEqual(expected.len, actual.items.len);
    for (actual.items, expected) |item, text| try std.testing.expectEqualStrings(text, item.string);
}

fn expectIntegers(actual: std.json.Array, expected: []const i64) !void {
    try std.testing.expectEqual(expected.len, actual.items.len);
    for (actual.items, expected) |item, value| try std.testing.expectEqual(value, item.integer);
}

fn expectMember(members: std.json.Array, name: []const u8, offset: i64) !void {
    try std.testing.expectEqual(offset, integerField(findNamedOnly(members, name), "offset"));
}

fn initializerWrites(symbol: std.json.ObjectMap) std.json.Array {
    return arrayField(objectField(symbol, "initializer"), "writes");
}

fn firstWrite(symbol: std.json.ObjectMap) std.json.ObjectMap {
    return initializerWrites(symbol).items[0].object;
}

fn expectIntegerInitializer(
    symbol: std.json.ObjectMap,
    offset: i64,
    bits: i64,
    signed: bool,
    value: []const u8,
) !void {
    const write = firstWrite(symbol);
    try std.testing.expectEqual(offset, integerField(write, "offset"));
    const constant = objectField(write, "value");
    try expectString(constant, "kind", "integer");
    try std.testing.expectEqual(bits, integerField(constant, "bits"));
    try std.testing.expectEqual(signed, boolField(constant, "signed"));
    try expectString(constant, "value", value);
}

fn expectFloatingInitializer(symbol: std.json.ObjectMap, bits: []const u8) !void {
    const constant = objectField(firstWrite(symbol), "value");
    try expectString(constant, "kind", "floating");
    try expectString(constant, "ieeeBits", bits);
}

fn expectWrite(write: std.json.ObjectMap, offset: i64, value: []const u8) !void {
    try std.testing.expectEqual(offset, integerField(write, "offset"));
    try expectString(objectField(write, "value"), "value", value);
}
