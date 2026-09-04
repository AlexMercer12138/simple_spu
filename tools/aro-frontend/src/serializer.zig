const std = @import("std");
const aro = @import("aro");
const diagnostics = @import("diagnostics.zig");
const source_provider = @import("source_provider.zig");
const serialize_symbols = @import("serialize_symbols.zig");
const serialize_types = @import("serialize_types.zig");
const serialize_nodes = @import("serialize_nodes.zig");

pub const SourceState = source_provider.State;

pub const Status = enum {
    ok,
    diagnostics,
    @"internal-error",
};

pub const Error = anyerror;

pub fn envelope(
    allocator: std.mem.Allocator,
    limit: u32,
    build_id: []const u8,
    status: Status,
    diagnostic_records: []const diagnostics.Diagnostic,
    sources: *const source_provider.State,
    tree: ?*const aro.Tree,
) Error![]const u8 {
    return envelopeInternal(
        allocator,
        limit,
        build_id,
        status,
        diagnostic_records,
        sources,
        tree,
        null,
    );
}

pub fn envelopeWithPreprocessor(
    allocator: std.mem.Allocator,
    limit: u32,
    build_id: []const u8,
    status: Status,
    diagnostic_records: []const diagnostics.Diagnostic,
    sources: *const source_provider.State,
    tree: ?*const aro.Tree,
    preprocessor: *const aro.Preprocessor,
) Error![]const u8 {
    return envelopeInternal(
        allocator,
        limit,
        build_id,
        status,
        diagnostic_records,
        sources,
        tree,
        preprocessor,
    );
}

fn envelopeInternal(
    allocator: std.mem.Allocator,
    limit: u32,
    build_id: []const u8,
    status: Status,
    diagnostic_records: []const diagnostics.Diagnostic,
    sources: *const source_provider.State,
    tree: ?*const aro.Tree,
    preprocessor: ?*const aro.Preprocessor,
) Error![]const u8 {
    var output: Buffer = .{ .allocator = allocator, .limit = limit };
    errdefer output.list.deinit(allocator);
    try output.add("{\"protocolVersion\":1,\"bridgeBuildId\":");
    try output.string(build_id);
    try output.add(",\"status\":");
    try output.string(@tagName(status));
    try output.add(",\"diagnostics\":[");
    for (diagnostic_records, 0..) |diagnostic, index| {
        if (index != 0) try output.byte(',');
        try writeDiagnostic(&output, diagnostic);
    }
    try output.byte(']');

    if (status == .ok) {
        const analyzed_tree = tree orelse return error.MissingTree;
        var types = serialize_types.Store.init(allocator, analyzed_tree, sources);
        defer types.deinit();
        try types.collect();
        var symbols = serialize_symbols.Store.init(allocator, analyzed_tree, &types);
        defer symbols.deinit();
        try symbols.collect();
        var nodes = serialize_nodes.Store.init(allocator, analyzed_tree, preprocessor, &types, &symbols);
        defer nodes.deinit();
        try nodes.collect();

        try output.add(",\"unit\":{");
        try output.add("\"schema\":\"merc32.typed-c-unit\",\"schemaVersion\":1,");
        try output.add("\"target\":\"merc32\",\"abi\":\"merc32-c-v1\",");
        try output.add("\"dataModel\":\"merc32-ilp32\",\"language\":\"c17-freestanding\",");
        try output.add("\"sourceFiles\":");
        try writeSourceFiles(&output, sources);
        try output.add(",\"types\":");
        try types.write(&output);
        try output.add(",\"symbols\":");
        try symbols.write(&output);
        try output.add(",\"nodes\":");
        try nodes.write(&output);
        try output.add(",\"declarations\":");
        try nodes.writeDeclarations(&output);
        try output.byte('}');
    } else if (diagnostic_records.len != 0 and sources.files.items.len != 0) {
        try output.add(",\"sourceFiles\":");
        try writeSourceFiles(&output, sources);
    }
    try output.byte('}');
    return output.list.toOwnedSlice(allocator);
}

pub fn failureEnvelope(
    storage: []u8,
    build_id: []const u8,
    status: Status,
    code: []const u8,
    message: []const u8,
) []const u8 {
    var output = std.Io.Writer.fixed(storage);
    output.writeAll("{\"protocolVersion\":1,\"bridgeBuildId\":") catch return &.{};
    writeFixedString(&output, build_id) catch return &.{};
    output.writeAll(",\"status\":") catch return &.{};
    writeFixedString(&output, @tagName(status)) catch return &.{};
    output.writeAll(",\"diagnostics\":[{\"severity\":\"error\",\"code\":") catch return &.{};
    writeFixedString(&output, code) catch return &.{};
    output.writeAll(",\"message\":") catch return &.{};
    writeFixedString(&output, message) catch return &.{};
    output.writeAll(",\"range\":{\"file\":1,\"start\":{\"line\":1,\"column\":1,\"byteOffset\":0},\"end\":{\"line\":1,\"column\":1,\"byteOffset\":0}},\"related\":[],\"notes\":[],\"includeTrace\":[],\"macroExpansionTrace\":[]}],\"sourceFiles\":[{\"id\":1,\"path\":\"request.json\",\"byteLength\":0,\"utf8BoundaryBitmap\":\"01\"}]}") catch return &.{};
    return output.buffered();
}

fn writeFixedString(output: *std.Io.Writer, value: []const u8) std.Io.Writer.Error!void {
    try output.writeByte('"');
    for (value) |char| switch (char) {
        '"' => try output.writeAll("\\\""),
        '\\' => try output.writeAll("\\\\"),
        '\n' => try output.writeAll("\\n"),
        '\r' => try output.writeAll("\\r"),
        '\t' => try output.writeAll("\\t"),
        0x00...0x08, 0x0b, 0x0c, 0x0e...0x1f => {
            const hex = "0123456789abcdef";
            try output.writeAll(&.{ '\\', 'u', '0', '0', hex[char >> 4], hex[char & 0xf] });
        },
        else => try output.writeByte(char),
    };
    try output.writeByte('"');
}

fn writeSourceFiles(output: *Buffer, sources: *const source_provider.State) Error!void {
    try output.byte('[');
    for (sources.files.items, 0..) |file, index| {
        if (index != 0) try output.byte(',');
        try output.add("{\"id\":");
        try output.integer(file.id);
        try output.add(",\"path\":");
        try output.string(file.path);
        try output.add(",\"byteLength\":");
        try output.integer(file.source.len);
        try output.add(",\"utf8BoundaryBitmap\":");
        try writeUtf8BoundaryBitmap(output, file.source);
        try output.byte('}');
    }
    try output.byte(']');
}

fn writeUtf8BoundaryBitmap(output: *Buffer, source: []const u8) Error!void {
    const hex = "0123456789abcdef";
    const bit_count = source.len + 1;
    const byte_count = (bit_count + 7) / 8;
    try output.byte('"');
    for (0..byte_count) |byte_index| {
        var packed_byte: u8 = 0;
        for (0..8) |bit_index| {
            const offset = byte_index * 8 + bit_index;
            if (offset > source.len) break;
            if (offset == source.len or offset == 0 or source[offset] & 0xc0 != 0x80) {
                packed_byte |= @as(u8, 1) << @intCast(bit_index);
            }
        }
        try output.byte(hex[packed_byte >> 4]);
        try output.byte(hex[packed_byte & 0x0f]);
    }
    try output.byte('"');
}

fn writeDiagnostic(output: *Buffer, diagnostic: diagnostics.Diagnostic) Error!void {
    try output.add("{\"severity\":");
    try output.string(@tagName(diagnostic.severity));
    try output.add(",\"code\":");
    try output.string(diagnostic.code);
    try output.add(",\"message\":");
    try output.string(diagnostic.message);
    try output.add(",\"range\":");
    try writeRange(output, diagnostic.range);
    try output.add(",\"related\":[");
    for (diagnostic.related, 0..) |related, index| {
        if (index != 0) try output.byte(',');
        try output.add("{\"message\":");
        try output.string(related.message);
        try output.add(",\"range\":");
        try writeRange(output, related.range);
        try output.byte('}');
    }
    try output.add("],\"notes\":[");
    for (diagnostic.notes, 0..) |note, index| {
        if (index != 0) try output.byte(',');
        try output.string(note);
    }
    try output.add("],\"includeTrace\":[");
    for (diagnostic.include_trace, 0..) |range, index| {
        if (index != 0) try output.byte(',');
        try writeRange(output, range);
    }
    try output.add("],\"macroExpansionTrace\":[");
    for (diagnostic.macro_expansion_trace, 0..) |range, index| {
        if (index != 0) try output.byte(',');
        try writeRange(output, range);
    }
    try output.add("]}");
}

fn writeRange(output: *Buffer, range: diagnostics.Range) Error!void {
    try output.add("{\"file\":");
    try output.integer(range.file);
    try output.add(",\"start\":");
    try writePosition(output, range.start);
    try output.add(",\"end\":");
    try writePosition(output, range.end);
    try output.byte('}');
}

fn writePosition(output: *Buffer, position: diagnostics.Position) Error!void {
    try output.add("{\"line\":");
    try output.integer(position.line);
    try output.add(",\"column\":");
    try output.integer(position.column);
    try output.add(",\"byteOffset\":");
    try output.integer(position.byte_offset);
    try output.byte('}');
}

pub const Buffer = struct {
    allocator: std.mem.Allocator,
    limit: usize,
    list: std.ArrayList(u8) = .empty,

    pub fn add(buffer: *Buffer, bytes: []const u8) Error!void {
        if (bytes.len > buffer.limit -| buffer.list.items.len) return error.ResultTooLarge;
        try buffer.list.appendSlice(buffer.allocator, bytes);
    }

    pub fn byte(buffer: *Buffer, value: u8) Error!void {
        if (buffer.list.items.len == buffer.limit) return error.ResultTooLarge;
        try buffer.list.append(buffer.allocator, value);
    }

    pub fn integer(buffer: *Buffer, value: anytype) Error!void {
        var storage: [32]u8 = undefined;
        try buffer.add(std.fmt.bufPrint(&storage, "{d}", .{value}) catch unreachable);
    }

    pub fn string(buffer: *Buffer, value: []const u8) Error!void {
        try buffer.byte('"');
        for (value) |char| switch (char) {
            '"' => try buffer.add("\\\""),
            '\\' => try buffer.add("\\\\"),
            '\n' => try buffer.add("\\n"),
            '\r' => try buffer.add("\\r"),
            '\t' => try buffer.add("\\t"),
            0x00...0x08, 0x0b, 0x0c, 0x0e...0x1f => {
                const hex = "0123456789abcdef";
                try buffer.add(&.{ '\\', 'u', '0', '0', hex[char >> 4], hex[char & 0xf] });
            },
            else => try buffer.byte(char),
        };
        try buffer.byte('"');
    }
};

test "serialized result one byte over the hard cap fails without retaining its partial buffer" {
    var sources = source_provider.State.init(std.testing.allocator, @import("request.zig").hard_limits);
    defer sources.deinit();
    try sources.recordMain("main.c", "");

    const oversized_message = try std.testing.allocator.alloc(u8, (64 * 1024 * 1024) + 1);
    defer std.testing.allocator.free(oversized_message);
    @memset(oversized_message, 'x');
    const diagnostic: diagnostics.Diagnostic = .{
        .severity = .@"error",
        .code = "result-boundary",
        .message = oversized_message,
        .range = .{
            .file = 1,
            .start = .{ .line = 1, .column = 1, .byte_offset = 0 },
            .end = .{ .line = 1, .column = 1, .byte_offset = 0 },
        },
        .related = &.{},
        .notes = &.{},
        .include_trace = &.{},
        .macro_expansion_trace = &.{},
    };
    try std.testing.expectError(error.ResultTooLarge, envelope(
        std.testing.allocator,
        64 * 1024 * 1024,
        "test-build",
        .diagnostics,
        &.{diagnostic},
        &sources,
        null,
    ));
}

test "source tables encode UTF-8 boundaries as lowercase LSB-first hex" {
    var sources = source_provider.State.init(std.testing.allocator, @import("request.zig").hard_limits);
    defer sources.deinit();
    try sources.recordMain("main.c", &.{ 'a', 0xc3, 0xa9 });

    const diagnostic: diagnostics.Diagnostic = .{
        .severity = .@"error",
        .code = "utf8-boundaries",
        .message = "test",
        .range = .{
            .file = 1,
            .start = .{ .line = 1, .column = 1, .byte_offset = 0 },
            .end = .{ .line = 1, .column = 3, .byte_offset = 3 },
        },
        .related = &.{},
        .notes = &.{},
        .include_trace = &.{},
        .macro_expansion_trace = &.{},
    };
    const encoded = try envelope(
        std.testing.allocator,
        64 * 1024 * 1024,
        "test-build",
        .diagnostics,
        &.{diagnostic},
        &sources,
        null,
    );
    defer std.testing.allocator.free(encoded);
    try std.testing.expect(std.mem.indexOf(u8, encoded, "\"utf8BoundaryBitmap\":\"0b\"") != null);
}

test "fixed failure envelope includes the empty-source boundary bitmap" {
    var storage: [1024]u8 = undefined;
    const encoded = failureEnvelope(&storage, "test-build", .@"internal-error", "failure", "test");
    try std.testing.expect(std.mem.indexOf(u8, encoded, "\"utf8BoundaryBitmap\":\"01\"") != null);
}
