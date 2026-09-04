const std = @import("std");
const aro = @import("aro");
const probe = @import("data_model_probe");

const fixture = @embedFile("data-model.c");
const null_model_fixture =
    \\_Static_assert(__is_target_arch(x86_64), "null-model architecture");
    \\_Static_assert(__is_target_os(linux), "null-model OS");
    \\_Static_assert(__is_target_vendor(pc), "null-model vendor");
    \\_Static_assert(__is_target_environment(gnu), "null-model environment");
    \\_Static_assert(__has_builtin(__builtin_ia32_addcarryx_u64), "null-model builtin");
    \\_Static_assert(__has_feature(c_thread_local), "null-model feature");
    \\_Static_assert(__has_extension(c_thread_local), "null-model extension");
;

test "MERC32 public identity is explicit" {
    try std.testing.expectEqualStrings("merc32", probe.target);
    try std.testing.expectEqualStrings("merc32-c-v1", probe.abi);
    try std.testing.expectEqualStrings("merc32-ilp32", probe.data_model);
    try std.testing.expectEqualStrings("merc32\nmerc32-c-v1\nmerc32-ilp32\n", probe.output);
}

test "MERC32 compilation queries use the explicit data model" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var diagnostics: aro.Diagnostics = .{ .output = .ignore };
    defer diagnostics.deinit();
    var comp = try probe.initCompilation(std.testing.allocator, arena_state.allocator(), &diagnostics);
    defer comp.deinit();

    try std.testing.expectEqual(@as(u16, 32), comp.ptrBitWidth());
    try std.testing.expectEqual(@as(u16, 64), comp.cTypeBitSize(.longlong));
    try std.testing.expectEqual(@as(u16, 4), comp.cTypeAlignment(.longlong));
    try std.testing.expectEqual(aro.QualType.int, comp.intPtrType());
    try std.testing.expectEqual(aro.QualType.long_long, comp.intMaxType());
    try std.testing.expectEqual(aro.QualType.int, comp.wcharType());
    try std.testing.expectEqual(aro.QualType.uint, comp.wintType());
    try std.testing.expectEqual(aro.QualType.int, comp.sigAtomicType());
    try std.testing.expect(!comp.hasInt128());
    try std.testing.expect(!comp.hasFloat128());
    try std.testing.expectEqual(@as(u8, 4), comp.defaultFunctionAlignment());
    try std.testing.expectEqual(@as(?u16, 4), comp.maxFieldAlignment());
    try std.testing.expectEqual(std.builtin.Signedness.signed, comp.getCharSignedness());
}

test "MERC32 generated macros describe only the supported profile" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var diagnostics: aro.Diagnostics = .{ .output = .ignore };
    defer diagnostics.deinit();
    var comp = try probe.initCompilation(std.testing.allocator, arena_state.allocator(), &diagnostics);
    defer comp.deinit();

    const builtin = try comp.generateBuiltinMacros(.include_system_defines);
    const macros = builtin.buf;
    try expectDefine(macros, "__MERC32__", "1");
    try expectDefine(macros, "__merc32__", "1");
    try expectDefine(macros, "__STDC_HOSTED__", "0");
    try expectDefine(macros, "__STDC_NO_THREADS__", "1");
    try expectDefine(macros, "__STDC_VERSION__", "201710L");
    try expectDefine(macros, "__BYTE_ORDER__", "__ORDER_LITTLE_ENDIAN__");
    try expectDefine(macros, "__SIZEOF_POINTER__", "4");
    try expectDefine(macros, "__SIZEOF_LONG_LONG__", "8");
    try expectDefine(macros, "__INTPTR_TYPE__", "int");
    try expectDefine(macros, "__INTMAX_TYPE__", "long long");
    try expectDefine(macros, "__WCHAR_TYPE__", "int");
    try expectDefine(macros, "__WINT_TYPE__", "unsigned int");
    try expectDefine(macros, "__SIG_ATOMIC_TYPE__", "int");

    inline for (.{
        "__CHAR_UNSIGNED__",
        "__SIZEOF_INT128__",
        "__BITINT_MAXWIDTH__",
        "__FLOAT128__",
        "__SIZEOF_FLOAT128__",
        "__GCC_HAVE_TLS",
        "__GCC_HAVE_SYNC_COMPARE_AND_SWAP_8",
        "_REENTRANT",
        "_MT",
        "_WIN32",
        "__linux__",
        "__wasm__",
        "__i386__",
        "__x86_64__",
    }) |name| try expectNoDefine(macros, name);
}

test "MERC32 macros and aliases ignore an AVR backing CPU" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var diagnostics: aro.Diagnostics = .{ .output = .ignore };
    defer diagnostics.deinit();
    var baseline = try probe.initCompilationForBackingTarget(
        std.testing.allocator,
        arena_state.allocator(),
        &diagnostics,
        .merc32,
        .x86_64_linux,
    );
    defer baseline.deinit();
    var hostile = try probe.initCompilationForBackingTarget(
        std.testing.allocator,
        arena_state.allocator(),
        &diagnostics,
        .merc32,
        .avr_cpu_linux,
    );
    defer hostile.deinit();

    try std.testing.expectEqual(aro.QualType.short, hostile.intLeastN(16, .signed));
    try std.testing.expectEqual(aro.QualType.ushort, hostile.intLeastN(16, .unsigned));
    const baseline_macros = try baseline.generateBuiltinMacros(.include_system_defines);
    const hostile_macros = try hostile.generateBuiltinMacros(.include_system_defines);
    try std.testing.expectEqualStrings(baseline_macros.buf, hostile_macros.buf);
    try expectFixtureConforms(.avr_cpu_linux, .merc32, fixture);
}

test "MERC32 identity ignores a Darwin variant backing target" {
    try expectFixtureConforms(.darwin_variant, .merc32, fixture);
}

test "null data model preserves backing target behavior" {
    try expectFixtureConforms(.x86_64_linux, null, null_model_fixture);
}

test "MERC32 C17 fixture conforms through preprocessing and parsing" {
    try expectFixtureConforms(.x86_64_linux, .merc32, fixture);
}

fn expectFixtureConforms(
    backing_target: probe.BackingTarget,
    selected_data_model: ?aro.DataModel,
    source_contents: []const u8,
) !void {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    var diagnostics: aro.Diagnostics = .{ .output = .ignore };
    defer diagnostics.deinit();
    var comp = try probe.initCompilationForBackingTarget(
        std.testing.allocator,
        arena_state.allocator(),
        &diagnostics,
        selected_data_model,
        backing_target,
    );
    defer comp.deinit();

    const source = try comp.addSourceFromBuffer("data-model.c", source_contents);
    const builtin = try comp.generateBuiltinMacros(.include_system_defines);
    var pp = try aro.Preprocessor.init(&comp, .{
        .base_file = source.id,
        .source_epoch = .default,
    });
    defer pp.deinit();
    _ = try pp.preprocess(builtin);
    const eof = try pp.preprocess(source);
    try pp.addToken(eof);

    var tree = try aro.Parser.parse(&pp);
    defer tree.deinit();
    try std.testing.expectEqual(@as(u32, 0), diagnostics.errors);
}

fn expectDefine(macros: []const u8, name: []const u8, value: []const u8) !void {
    var expected_buffer: [128]u8 = undefined;
    const expected = try std.fmt.bufPrint(&expected_buffer, "#define {s} {s}\n", .{ name, value });
    try std.testing.expect(std.mem.indexOf(u8, macros, expected) != null);
}

fn expectNoDefine(macros: []const u8, name: []const u8) !void {
    var expected_buffer: [128]u8 = undefined;
    const expected = try std.fmt.bufPrint(&expected_buffer, "#define {s}", .{name});
    try std.testing.expect(std.mem.indexOf(u8, macros, expected) == null);
}
