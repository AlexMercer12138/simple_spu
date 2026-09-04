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
    comp: *const aro.Compilation,
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
                const note_range = rangeForExpanded(comp, sources, location);
                related[related_index] = .{ .message = note.text, .range = note_range };
                related_index += 1;
                if (std.mem.eql(u8, note.text, "expanded from here")) {
                    macro_trace[macro_index] = note_range;
                    macro_index += 1;
                }
            }
        }
        const primary_range = if (message.location) |location|
            rangeForExpanded(comp, sources, location)
        else
            startRange(sources.files.items[0]);
        result[output_index] = .{
            .severity = mapSeverity(message.effective_kind),
            .code = if (message.opt) |option| @tagName(option) else "aro",
            .message = message.text,
            .range = primary_range,
            .related = related,
            .notes = notes,
            .include_trace = try includeTrace(allocator, comp, sources, primary_range.file, index),
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

fn rangeForExpanded(
    comp: *const aro.Compilation,
    sources: *const source_provider.State,
    location: aro.Source.ExpandedLocation,
) Range {
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
    const end_offset = tokenEndOffset(comp, file, offset) orelse codepointEndOffset(source, offset);
    const end = positionAfter(source, offset, end_offset, wanted_line, @max(location.col, 1));
    return .{
        .file = file.id,
        .start = .{ .line = wanted_line, .column = @max(location.col, 1), .byte_offset = @intCast(offset) },
        .end = end,
    };
}

fn tokenEndOffset(comp: *const aro.Compilation, file: source_provider.SourceFile, offset: usize) ?usize {
    const aro_id = file.aro_id orelse return null;
    const source = comp.getSource(aro_id);
    var tokenizer: aro.Tokenizer = .{
        .buf = source.buf,
        .source = source.id,
        .langopts = comp.langopts,
        .splice_locs = source.splice_locs,
    };
    while (true) {
        const token = tokenizer.next();
        const start: usize = token.start;
        const end: usize = token.end;
        if (start > offset or token.id == .eof) return null;
        if (start <= offset and offset < end) return @min(end, file.source.len);
    }
}

fn codepointEndOffset(source: []const u8, offset: usize) usize {
    if (offset >= source.len or source[offset] == '\n') return offset;
    const sequence_len = std.unicode.utf8ByteSequenceLength(source[offset]) catch 1;
    return offset + @min(sequence_len, source.len - offset);
}

fn positionAfter(
    source: []const u8,
    start_offset: usize,
    end_offset: usize,
    start_line: u32,
    start_column: u32,
) Position {
    var position: Position = .{
        .line = start_line,
        .column = start_column,
        .byte_offset = @intCast(start_offset),
    };
    var offset = start_offset;
    while (offset < end_offset) {
        if (source[offset] == '\n') {
            offset += 1;
            position.line += 1;
            position.column = 1;
        } else {
            const sequence_len = std.unicode.utf8ByteSequenceLength(source[offset]) catch 1;
            offset += @min(sequence_len, end_offset - offset);
            position.column += 1;
        }
    }
    position.byte_offset = @intCast(end_offset);
    return position;
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
    comp: *const aro.Compilation,
    sources: *const source_provider.State,
    file_id: u32,
    diagnostic_index: usize,
) std.mem.Allocator.Error![]const Range {
    if (file_id == 0 or file_id > sources.files.items.len) return &.{};
    var ranges: std.ArrayList(Range) = .empty;
    var current = sources.files.items[file_id - 1];
    var remaining = sources.files.items.len;
    while (remaining != 0) : (remaining -= 1) {
        const include_event = findIncludeEvent(sources, current.id, diagnostic_index) orelse break;
        const include_range = rangeForExpanded(comp, sources, include_event.site);
        try ranges.append(allocator, include_range);
        if (include_range.file == 0 or include_range.file > sources.files.items.len) break;
        current = sources.files.items[include_range.file - 1];
    }
    return ranges.toOwnedSlice(allocator);
}

fn findIncludeEvent(
    sources: *const source_provider.State,
    source_id: u32,
    diagnostic_index: usize,
) ?source_provider.IncludeEvent {
    var found: ?source_provider.IncludeEvent = null;
    for (sources.include_events.items) |event| {
        if (event.source_id == source_id and event.diagnostic_index <= diagnostic_index) found = event;
    }
    return found;
}
