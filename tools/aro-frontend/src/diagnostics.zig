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

    var token_index = try TokenIndex.init(allocator, comp, messages, sources);
    defer token_index.deinit();
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
                const note_range = rangeForExpanded(sources, &token_index, location);
                related[related_index] = .{ .message = note.text, .range = note_range };
                related_index += 1;
                if (std.mem.eql(u8, note.text, "expanded from here")) {
                    macro_trace[macro_index] = note_range;
                    macro_index += 1;
                }
            }
        }
        const primary_range = if (message.location) |location|
            rangeForExpanded(sources, &token_index, location)
        else
            startRange(sources.files.items[0]);
        result[output_index] = .{
            .severity = mapSeverity(message.effective_kind),
            .code = if (message.opt) |option| @tagName(option) else "aro",
            .message = message.text,
            .range = primary_range,
            .related = related,
            .notes = notes,
            .include_trace = if (message.location) |location|
                try includeTrace(allocator, sources, &token_index, location.source_id)
            else
                &.{},
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

const TokenIndex = struct {
    const Entry = struct {
        file_id: u32,
        offset: usize,
        end: ?usize = null,

        fn lessThan(_: void, lhs: Entry, rhs: Entry) bool {
            return lhs.file_id < rhs.file_id or
                (lhs.file_id == rhs.file_id and lhs.offset < rhs.offset);
        }
    };

    allocator: std.mem.Allocator,
    entries: []Entry,
    source_scan_count: usize = 0,

    fn init(
        allocator: std.mem.Allocator,
        comp: *const aro.Compilation,
        messages: []const aro.Diagnostics.Message,
        sources: *const source_provider.State,
    ) std.mem.Allocator.Error!TokenIndex {
        var entries: std.ArrayList(Entry) = .empty;
        defer entries.deinit(allocator);

        for (messages) |message| {
            if (message.location) |location| try addLocation(&entries, allocator, sources, location);
            if (message.effective_kind == .note) continue;
            const location = message.location orelse continue;
            var instance_index = sources.instanceIndex(location.source_id);
            var remaining = sources.instances.items.len;
            while (instance_index) |index| {
                if (remaining == 0) break;
                remaining -= 1;
                const instance = sources.instances.items[index];
                if (instance.included_from) |site| try addLocation(&entries, allocator, sources, site);
                instance_index = instance.parent_instance;
            }
        }

        std.sort.heap(Entry, entries.items, {}, Entry.lessThan);
        if (entries.items.len != 0) {
            var write_index: usize = 1;
            for (entries.items[1..]) |entry| {
                const previous = entries.items[write_index - 1];
                if (entry.file_id == previous.file_id and entry.offset == previous.offset) continue;
                entries.items[write_index] = entry;
                write_index += 1;
            }
            entries.items.len = write_index;
        }

        var token_index: TokenIndex = .{
            .allocator = allocator,
            .entries = try entries.toOwnedSlice(allocator),
        };
        errdefer token_index.deinit();
        token_index.scanSources(comp, sources);
        return token_index;
    }

    fn deinit(index: *TokenIndex) void {
        index.allocator.free(index.entries);
    }

    fn addLocation(
        entries: *std.ArrayList(Entry),
        allocator: std.mem.Allocator,
        sources: *const source_provider.State,
        location: aro.Source.ExpandedLocation,
    ) std.mem.Allocator.Error!void {
        const file = fileForLocation(sources, location);
        try entries.append(allocator, .{
            .file_id = file.id,
            .offset = @min(@as(usize, location.byte_offset), file.source.len),
        });
    }

    fn scanSources(index: *TokenIndex, comp: *const aro.Compilation, sources: *const source_provider.State) void {
        var group_start: usize = 0;
        while (group_start < index.entries.len) {
            const file_id = index.entries[group_start].file_id;
            var group_end = group_start + 1;
            while (group_end < index.entries.len and index.entries[group_end].file_id == file_id) : (group_end += 1) {}
            const file = sources.fileById(file_id) orelse {
                group_start = group_end;
                continue;
            };
            const aro_id = file.aro_id orelse {
                group_start = group_end;
                continue;
            };
            const source = comp.getSource(aro_id);
            var tokenizer: aro.Tokenizer = .{
                .buf = source.buf,
                .source = source.id,
                .langopts = comp.langopts,
                .splice_locs = source.splice_locs,
            };
            index.source_scan_count += 1;

            var query_index = group_start;
            while (query_index < group_end) {
                const token = tokenizer.next();
                const token_start: usize = token.start;
                const token_end: usize = token.end;
                while (query_index < group_end and index.entries[query_index].offset < token_start) : (query_index += 1) {}
                while (query_index < group_end and index.entries[query_index].offset < token_end) : (query_index += 1) {
                    index.entries[query_index].end = @min(token_end, file.source.len);
                }
                if (token.id == .eof) break;
            }
            group_start = group_end;
        }
    }

    fn findEnd(index: *const TokenIndex, file_id: u32, offset: usize) ?usize {
        const Key = struct { file_id: u32, offset: usize };
        const key: Key = .{ .file_id = file_id, .offset = offset };
        const entry_index = std.sort.binarySearch(Entry, index.entries, key, struct {
            fn order(wanted: Key, entry: Entry) std.math.Order {
                const file_order = std.math.order(wanted.file_id, entry.file_id);
                if (file_order != .eq) return file_order;
                return std.math.order(wanted.offset, entry.offset);
            }
        }.order) orelse return null;
        return index.entries[entry_index].end;
    }
};

fn fileForLocation(sources: *const source_provider.State, location: aro.Source.ExpandedLocation) source_provider.SourceFile {
    return sources.fileForAroId(location.source_id) orelse
        sources.find(location.path) orelse
        sources.files.items[0];
}

fn rangeForExpanded(
    sources: *const source_provider.State,
    token_index: *const TokenIndex,
    location: aro.Source.ExpandedLocation,
) Range {
    const file = fileForLocation(sources, location);
    const source = file.source;
    const offset = @min(@as(usize, location.byte_offset), source.len);
    const line = @max(location.line_no, 1);
    const column = @max(location.col, 1);
    const end_offset = token_index.findEnd(file.id, offset) orelse codepointEndOffset(source, offset);
    const end = positionAfter(source, offset, end_offset, line, column);
    return .{
        .file = file.id,
        .start = .{ .line = line, .column = column, .byte_offset = @intCast(offset) },
        .end = end,
    };
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
    sources: *const source_provider.State,
    token_index: *const TokenIndex,
    source_id: aro.Source.Id,
) std.mem.Allocator.Error![]const Range {
    var ranges: std.ArrayList(Range) = .empty;
    var instance_index = sources.instanceIndex(source_id);
    var remaining = sources.instances.items.len;
    while (instance_index) |index| {
        if (remaining == 0) break;
        remaining -= 1;
        const instance = sources.instances.items[index];
        const site = instance.included_from orelse break;
        try ranges.append(allocator, rangeForExpanded(sources, token_index, site));
        instance_index = instance.parent_instance;
    }
    return ranges.toOwnedSlice(allocator);
}

test "token index scans each diagnostic source once" {
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
        .add_default_pragma_handlers = false,
    });
    defer comp.deinit();
    comp.langopts.standard = .c17;

    const source_text = "int alpha = + first_bad;\nint beta = + second_bad;\n";
    const aro_source = try comp.addSourceFromBuffer("main.c", source_text);
    var sources = source_provider.State.init(std.testing.allocator, @import("request.zig").hard_limits);
    defer sources.deinit();
    try sources.recordMain("main.c", source_text);
    try sources.bindMain(aro_source);

    const first_offset = std.mem.indexOf(u8, source_text, "first_bad").?;
    const second_offset = std.mem.indexOf(u8, source_text, "second_bad").?;
    const messages = [_]aro.Diagnostics.Message{
        .{
            .kind = .@"error",
            .effective_kind = .@"error",
            .text = "first",
            .location = (aro.Source.Location{
                .id = aro_source.id,
                .byte_offset = @intCast(first_offset),
                .line = 1,
            }).expand(&comp),
        },
        .{
            .kind = .@"error",
            .effective_kind = .@"error",
            .text = "second",
            .location = (aro.Source.Location{
                .id = aro_source.id,
                .byte_offset = @intCast(second_offset),
                .line = 2,
            }).expand(&comp),
        },
    };

    var token_index = try TokenIndex.init(std.testing.allocator, &comp, &messages, &sources);
    defer token_index.deinit();
    try std.testing.expectEqual(@as(usize, 1), token_index.source_scan_count);
    try std.testing.expectEqual(first_offset + "first_bad".len, token_index.findEnd(1, first_offset).?);
    try std.testing.expectEqual(second_offset + "second_bad".len, token_index.findEnd(1, second_offset).?);
}
