const std = @import("std");
const diagnostics = @import("diagnostics.zig");
const source_provider = @import("source_provider.zig");

pub const Status = enum {
    ok,
    diagnostics,
    @"internal-error",
};

pub const Error = error{ResultTooLarge} || std.mem.Allocator.Error;

pub fn envelope(
    allocator: std.mem.Allocator,
    limit: u32,
    build_id: []const u8,
    status: Status,
    diagnostic_records: []const diagnostics.Diagnostic,
    sources: *const source_provider.State,
) Error![]const u8 {
    var output: Buffer = .{ .allocator = allocator, .limit = limit };
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
        try output.add(",\"unit\":{");
        try output.add("\"schema\":\"merc32.typed-c-unit\",\"schemaVersion\":1,");
        try output.add("\"target\":\"merc32\",\"abi\":\"merc32-c-v1\",");
        try output.add("\"dataModel\":\"merc32-ilp32\",\"language\":\"c17-freestanding\",");
        try output.add("\"sourceFiles\":");
        try writeSourceFiles(&output, sources);
        try output.add(",\"types\":[],\"symbols\":[],\"nodes\":[],\"declarations\":[]}");
    } else if (diagnostic_records.len != 0 and sources.files.items.len != 0) {
        try output.add(",\"sourceFiles\":");
        try writeSourceFiles(&output, sources);
    }
    try output.byte('}');
    return output.list.toOwnedSlice(allocator);
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
        try output.byte('}');
    }
    try output.byte(']');
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

const Buffer = struct {
    allocator: std.mem.Allocator,
    limit: usize,
    list: std.ArrayList(u8) = .empty,

    fn add(buffer: *Buffer, bytes: []const u8) Error!void {
        if (bytes.len > buffer.limit -| buffer.list.items.len) return error.ResultTooLarge;
        try buffer.list.appendSlice(buffer.allocator, bytes);
    }

    fn byte(buffer: *Buffer, value: u8) Error!void {
        if (buffer.list.items.len == buffer.limit) return error.ResultTooLarge;
        try buffer.list.append(buffer.allocator, value);
    }

    fn integer(buffer: *Buffer, value: anytype) Error!void {
        var storage: [32]u8 = undefined;
        try buffer.add(std.fmt.bufPrint(&storage, "{d}", .{value}) catch unreachable);
    }

    fn string(buffer: *Buffer, value: []const u8) Error!void {
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
