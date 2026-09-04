const std = @import("std");
const aro = @import("aro");
const source_provider = @import("source_provider.zig");

pub const Severity = enum {
    note,
    warning,
    @"error",
    fatal,
};

pub const Position = struct {
    line: u32,
    column: u32,
    byte_offset: u32,
};

pub const Range = struct {
    file: u32,
    start: Position,
    end: Position,
};

pub const Related = struct {
    message: []const u8,
    range: Range,
};

pub const Diagnostic = struct {
    severity: Severity,
    code: []const u8,
    message: []const u8,
    range: Range,
    related: []const Related,
    notes: []const []const u8,
    include_trace: []const Range,
    macro_expansion_trace: []const Range,
};

pub fn collect(
    allocator: std.mem.Allocator,
    aro_diagnostics: *const aro.Diagnostics,
    sources: *const source_provider.State,
) std.mem.Allocator.Error![]const Diagnostic {
    const messages = switch (aro_diagnostics.output) {
        .to_list => |list| list.messages.items,
        else => return &.{},
    };
    var count: usize = 0;
    for (messages) |message| if (message.effective_kind != .note) {
        count += 1;
    };
    if (count == 0) return &.{};

    const result = try allocator.alloc(Diagnostic, count);
    var output_index: usize = 0;
    var index: usize = 0;
    while (index < messages.len) {
        const message = messages[index];
        if (message.effective_kind == .note) {
            index += 1;
            continue;
        }
        var end = index + 1;
        while (end < messages.len and messages[end].effective_kind == .note) : (end += 1) {}
        const chained = messages[index + 1 .. end];

        var related_count: usize = 0;
        var macro_count: usize = 0;
        for (chained) |note| {
            related_count += @intFromBool(note.location != null);
            macro_count += @intFromBool(std.mem.eql(u8, note.text, "expanded from here") and note.location != null);
        }
        const related = try allocator.alloc(Related, related_count);
        const notes = try allocator.alloc([]const u8, chained.len);
        const macro_trace = try allocator.alloc(Range, macro_count);
        var related_index: usize = 0;
        var macro_index: usize = 0;
        for (chained, 0..) |note, note_index| {
            notes[note_index] = note.text;
            if (note.location) |location| {
                const note_range = rangeForExpanded(sources, location);
                related[related_index] = .{ .message = note.text, .range = note_range };
                related_index += 1;
                if (std.mem.eql(u8, note.text, "expanded from here")) {
                    macro_trace[macro_index] = note_range;
                    macro_index += 1;
                }
            }
        }
        const primary_range = if (message.location) |location|
            rangeForExpanded(sources, location)
        else
            startRange(sources.files.items[0]);
        result[output_index] = .{
            .severity = mapSeverity(message.effective_kind),
            .code = if (message.opt) |option| @tagName(option) else "aro",
            .message = message.text,
            .range = primary_range,
            .related = related,
            .notes = notes,
            .include_trace = try includeTrace(allocator, sources, primary_range.file),
            .macro_expansion_trace = macro_trace,
        };
        output_index += 1;
        index = end;
    }
    return result;
}

pub fn resource(
    allocator: std.mem.Allocator,
    sources: *const source_provider.State,
    code: []const u8,
    message: []const u8,
) std.mem.Allocator.Error![]const Diagnostic {
    const diagnostics = try allocator.alloc(Diagnostic, 1);
    diagnostics[0] = .{
        .severity = .@"error",
        .code = code,
        .message = message,
        .range = startRange(sources.files.items[0]),
        .related = &.{},
        .notes = &.{},
        .include_trace = &.{},
        .macro_expansion_trace = &.{},
    };
    return diagnostics;
}

fn mapSeverity(kind: aro.Diagnostics.Message.Kind) Severity {
    return switch (kind) {
        .note => .note,
        .warning => .warning,
        .@"error" => .@"error",
        .@"fatal error" => .fatal,
        .off => unreachable,
    };
}

fn rangeForExpanded(sources: *const source_provider.State, location: aro.Source.ExpandedLocation) Range {
    const file = sources.find(location.path) orelse sources.files.items[0];
    const source = file.source;
    const wanted_line = @max(location.line_no, 1);
    var line: u32 = 1;
    var offset: usize = 0;
    while (line < wanted_line and offset < source.len) : (offset += 1) {
        if (source[offset] == '\n') line += 1;
    }
    var column: u32 = 1;
    while (column < @max(location.col, 1) and offset < source.len and source[offset] != '\n') : (column += 1) {
        const sequence_len = std.unicode.utf8ByteSequenceLength(source[offset]) catch 1;
        offset += @min(sequence_len, source.len - offset);
    }
    var end_offset = offset;
    var end_column = @max(location.col, 1);
    var remaining_width = @max(location.width, 1);
    while (remaining_width != 0 and end_offset < source.len and source[end_offset] != '\n') {
        const sequence_len = std.unicode.utf8ByteSequenceLength(source[end_offset]) catch 1;
        end_offset += @min(sequence_len, source.len - end_offset);
        end_column += 1;
        remaining_width -= 1;
    }
    return .{
        .file = file.id,
        .start = .{ .line = wanted_line, .column = @max(location.col, 1), .byte_offset = @intCast(offset) },
        .end = .{
            .line = wanted_line,
            .column = end_column,
            .byte_offset = @intCast(end_offset),
        },
    };
}

fn startRange(file: source_provider.SourceFile) Range {
    return .{
        .file = file.id,
        .start = .{ .line = 1, .column = 1, .byte_offset = 0 },
        .end = .{ .line = 1, .column = 1 + @intFromBool(file.source.len > 0), .byte_offset = @intFromBool(file.source.len > 0) },
    };
}

fn includeTrace(
    allocator: std.mem.Allocator,
    sources: *const source_provider.State,
    file_id: u32,
) std.mem.Allocator.Error![]const Range {
    if (file_id == 0 or file_id > sources.files.items.len) return &.{};
    var ranges: std.ArrayList(Range) = .empty;
    var current = sources.files.items[file_id - 1];
    var remaining = sources.files.items.len;
    while (remaining != 0) : (remaining -= 1) {
        const include_site = current.included_from orelse break;
        const include_range = rangeForExpanded(sources, include_site);
        try ranges.append(allocator, include_range);
        if (include_range.file == 0 or include_range.file > sources.files.items.len) break;
        current = sources.files.items[include_range.file - 1];
    }
    return ranges.toOwnedSlice(allocator);
}
