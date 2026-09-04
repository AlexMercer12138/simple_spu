const std = @import("std");
const aro = @import("aro");
const bridge_options = @import("bridge_options");
const abi = @import("abi.zig");
const request = @import("request.zig");
const source_provider = @import("source_provider.zig");
const diagnostics = @import("diagnostics.zig");
const serializer = @import("serializer.zig");

const build_id = bridge_options.bridge_build_id;
var state: abi.State = .{};

pub export fn merc32_alloc(len: u32) u32 {
    return state.allocRequest(len);
}

pub export fn merc32_analyze(ptr: u32, len: u32) i32 {
    const json = state.requestSlice(ptr, len) orelse {
        writeRequestFailure(.@"internal-error", "invalid-request", "request pointer or length does not match merc32_alloc");
        return -1;
    };
    analyze(json) catch {
        writeRequestFailure(.diagnostics, "resource-limit", "frontend memory limit exceeded");
        return -1;
    };
    return 0;
}

pub export fn merc32_result_ptr() u32 {
    return state.resultPtr();
}

pub export fn merc32_result_len() u32 {
    return state.resultLen();
}

pub export fn merc32_reset() void {
    state.reset();
}

pub export fn merc32_protocol_version() u32 {
    return abi.protocol_version;
}

pub export fn merc32_build_id_ptr() u32 {
    return @intCast(@intFromPtr(build_id.ptr));
}

pub export fn merc32_build_id_len() u32 {
    return build_id.len;
}

fn analyze(json: []const u8) !void {
    const allocator = state.arena.allocator();
    const parsed = request.parse(allocator, json) catch |err| {
        const status: serializer.Status = if (err == error.ResourceLimit) .diagnostics else .@"internal-error";
        const code = if (err == error.ResourceLimit) "resource-limit" else "invalid-request";
        const message = if (err == error.ResourceLimit)
            "request exceeds the configured frontend resource limits"
        else
            @errorName(err);
        try writeFailure(allocator, status, code, message);
        return;
    };

    var sources = source_provider.State.init(allocator, parsed.limits);
    try sources.recordMain(parsed.main_path, parsed.source);
    var aro_diagnostics: aro.Diagnostics = .{
        .output = .{ .to_list = .{ .arena = .init(allocator) } },
    };
    defer aro_diagnostics.deinit();
    const provider = sources.provider();
    var comp = try aro.Compilation.init(.{
        .gpa = allocator,
        .arena = allocator,
        .io = std.Io.failing,
        .diagnostics = &aro_diagnostics,
        .environ_map = null,
        .data_model = .merc32,
        .source_provider = provider,
        .max_include_depth = parsed.limits.include_depth,
        .add_default_pragma_handlers = false,
    });
    defer comp.deinit();
    comp.langopts.standard = .c17;

    const include_records = try allocator.alloc(aro.Compilation.Include, parsed.include_paths.len);
    for (parsed.include_paths, 0..) |path, index| {
        include_records[index] = .{ .kind = .normal, .path = path };
    }
    try comp.initSearchPath(include_records, false);

    const main_source = try comp.addSourceFromBuffer(parsed.main_path, parsed.source);
    const builtin_source = try comp.generateBuiltinMacros(.include_system_defines);
    var command_line_text: std.ArrayList(u8) = .empty;
    for (parsed.defines) |define| {
        try command_line_text.print(allocator, "#define {s} {s}\n", .{ define.name, define.value });
    }
    const command_line_source = if (command_line_text.items.len == 0)
        null
    else
        try comp.addSourceFromBuffer("<command line>", command_line_text.items);

    var pp = try aro.Preprocessor.init(&comp, .{
        .base_file = main_source.id,
        .source_epoch = .default,
    });
    defer pp.deinit();
    var compilation_failed = false;
    pp.preprocessSources(.{
        .main = main_source,
        .builtin = builtin_source,
        .command_line = command_line_source,
    }) catch |err| switch (err) {
        error.FatalError => compilation_failed = true,
        else => |other| return other,
    };
    var tree: ?aro.Tree = if (compilation_failed) null else aro.Parser.parse(&pp) catch |err| switch (err) {
        error.FatalError => blk: {
            compilation_failed = true;
            break :blk null;
        },
        else => |other| return other,
    };
    defer if (tree) |*parsed_tree| parsed_tree.deinit();

    const diagnostic_records = try diagnostics.collect(allocator, &aro_diagnostics, &sources);
    const status: serializer.Status = if (!compilation_failed and aro_diagnostics.errors == 0) .ok else .diagnostics;
    const encoded = serializer.envelope(
        allocator,
        parsed.limits.result_bytes,
        build_id,
        status,
        diagnostic_records,
        &sources,
    ) catch |err| switch (err) {
        error.ResultTooLarge => blk: {
            const records = try diagnostics.resource(
                allocator,
                &sources,
                "result-bytes",
                "serialized frontend result exceeds resultBytes",
            );
            break :blk try serializer.envelope(
                allocator,
                request.hard_limits.result_bytes,
                build_id,
                .diagnostics,
                records,
                &sources,
            );
        },
        else => |other| return other,
    };
    state.setResult(encoded);
}

fn writeFailure(
    allocator: std.mem.Allocator,
    status: serializer.Status,
    code: []const u8,
    message: []const u8,
) !void {
    var sources = source_provider.State.init(allocator, request.hard_limits);
    try sources.recordMain("request.json", "");
    const records = try diagnostics.resource(allocator, &sources, code, message);
    state.setResult(try serializer.envelope(
        allocator,
        request.hard_limits.result_bytes,
        build_id,
        status,
        records,
        &sources,
    ));
}

fn writeRequestFailure(status: serializer.Status, code: []const u8, message: []const u8) void {
    const allocator = state.arena.allocator();
    writeFailure(allocator, status, code, message) catch state.setResult(&.{});
}
