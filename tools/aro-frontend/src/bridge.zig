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

const FailureCategory = enum {
    protocol,
    resource,
    compiler_diagnostic,
    internal,
};

const Failure = struct {
    category: FailureCategory,
    code: []const u8,
    message: []const u8,
};

pub export fn merc32_alloc(len: u32) u32 {
    return state.allocRequest(len);
}

pub export fn merc32_analyze(ptr: u32, len: u32) i32 {
    const json = state.requestSlice(ptr, len) orelse {
        writeBoundaryFailure(error.InvalidRequestPointer);
        return -1;
    };
    analyze(json) catch |err| {
        writeBoundaryFailure(err);
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
    const allocator = state.allocator();
    const parsed = try request.parse(allocator, json);
    if (!state.lowerMemoryLimit(parsed.limits.memory_bytes)) return error.MemoryLimit;

    var sources = source_provider.State.init(allocator, parsed.limits);
    try sources.seed(parsed.main_path, parsed.source, parsed.virtual_files);
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
    try sources.bindMain(main_source);
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
        error.FatalError => {
            if (comp.source_provider_failure) |failure| return providerFailureError(failure);
            compilation_failed = true;
        },
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

    const diagnostic_records = try diagnostics.collect(allocator, &comp, &aro_diagnostics, &sources);
    const status: serializer.Status = if (!compilation_failed and aro_diagnostics.errors == 0) .ok else .diagnostics;
    const encoded = try serializer.envelopeWithPreprocessor(
        allocator,
        parsed.limits.result_bytes,
        build_id,
        status,
        diagnostic_records,
        &sources,
        if (tree) |*parsed_tree| parsed_tree else null,
        &pp,
    );
    state.setResult(encoded);
}

fn providerFailureError(failure: source_provider.Failure) error{
    SourceHostRead,
    SourceInvalidRecord,
    SourceInvalidUtf8,
    SourceInvalidPath,
    SourceFileBytes,
    SourceTotalBytes,
    SourceFileCount,
} {
    return switch (failure) {
        .host_read => error.SourceHostRead,
        .invalid_record => error.SourceInvalidRecord,
        .invalid_utf8 => error.SourceInvalidUtf8,
        .invalid_path => error.SourceInvalidPath,
        .file_bytes => error.SourceFileBytes,
        .total_source_bytes => error.SourceTotalBytes,
        .file_count => error.SourceFileCount,
    };
}

fn writeBoundaryFailure(err: anyerror) void {
    const failure = classifyFailure(err);
    state.setFailureResult(
        build_id,
        statusForCategory(failure.category),
        failure.code,
        failure.message,
    );
}

fn statusForCategory(category: FailureCategory) serializer.Status {
    return switch (category) {
        .resource, .compiler_diagnostic => .diagnostics,
        .protocol, .internal => .@"internal-error",
    };
}

fn classifyFailure(err: anyerror) Failure {
    return switch (err) {
        error.OutOfMemory, error.MemoryLimit => .{
            .category = .resource,
            .code = "memory-bytes",
            .message = "frontend memory usage exceeds memoryBytes",
        },
        error.ResourceLimit => .{
            .category = .resource,
            .code = "resource-limit",
            .message = "request exceeds the configured frontend resource limits",
        },
        error.ResultTooLarge => .{
            .category = .resource,
            .code = "result-bytes",
            .message = "serialized frontend result exceeds resultBytes",
        },
        error.SourceHostRead => .{
            .category = .resource,
            .code = "source-host-read",
            .message = "host source resolver could not read the requested file",
        },
        error.SourceFileBytes => .{
            .category = .resource,
            .code = "source-file-bytes",
            .message = "resolved source exceeds fileBytes",
        },
        error.SourceTotalBytes => .{
            .category = .resource,
            .code = "source-total-bytes",
            .message = "resolved sources exceed totalSourceBytes",
        },
        error.SourceFileCount => .{
            .category = .resource,
            .code = "source-file-count",
            .message = "resolved sources exceed fileCount",
        },
        error.SourceInvalidRecord => .{
            .category = .protocol,
            .code = "source-invalid-record",
            .message = "host source resolver returned a malformed record",
        },
        error.SourceInvalidUtf8 => .{
            .category = .protocol,
            .code = "source-invalid-utf8",
            .message = "host source resolver returned invalid UTF-8",
        },
        error.SourceInvalidPath => .{
            .category = .protocol,
            .code = "source-invalid-path",
            .message = "host source resolver returned an invalid canonical path",
        },
        error.InvalidRequestPointer => .{
            .category = .protocol,
            .code = "invalid-request",
            .message = "request pointer or length does not match merc32_alloc",
        },
        error.InvalidJson,
        error.InvalidRequest,
        error.InvalidProtocol,
        error.InvalidStandard,
        error.InvalidLimits,
        error.InvalidPath,
        error.DuplicateVirtualFile,
        error.UnsortedDefines,
        => .{
            .category = .protocol,
            .code = "invalid-request",
            .message = @errorName(err),
        },
        else => .{
            .category = .internal,
            .code = "internal-error",
            .message = @errorName(err),
        },
    };
}
