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
) (std.mem.Allocator.Error || aro.Source.OriginalLocationMapper.Error)![]const Diagnostic {
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
        translated_offset: usize,
        translated_end: ?usize = null,
        original_start: ?Position = null,
        original_end: ?Position = null,

        fn lessThan(_: void, lhs: Entry, rhs: Entry) bool {
            return lhs.file_id < rhs.file_id or
                (lhs.file_id == rhs.file_id and lhs.translated_offset < rhs.translated_offset);
        }
    };

    const MappedRange = struct {
        start: Position,
        end: Position,
    };

    allocator: std.mem.Allocator,
    entries: []Entry,
    source_scan_count: usize = 0,
    source_map_count: usize = 0,

    fn init(
        allocator: std.mem.Allocator,
        comp: *const aro.Compilation,
        messages: []const aro.Diagnostics.Message,
        sources: *const source_provider.State,
    ) (std.mem.Allocator.Error || aro.Source.OriginalLocationMapper.Error)!TokenIndex {
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
                if (entry.file_id == previous.file_id and entry.translated_offset == previous.translated_offset) continue;
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
        try token_index.scanSources(comp, sources);
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
            .translated_offset = location.byte_offset,
        });
    }

    fn scanSources(
        index: *TokenIndex,
        comp: *const aro.Compilation,
        sources: *const source_provider.State,
    ) aro.Source.OriginalLocationMapper.Error!void {
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
                while (query_index < group_end and index.entries[query_index].translated_offset < token_start) : (query_index += 1) {}
                while (query_index < group_end and index.entries[query_index].translated_offset < token_end) : (query_index += 1) {
                    index.entries[query_index].translated_end = token_end;
                }
                if (token.id == .eof) break;
            }
            for (index.entries[group_start..group_end]) |*entry| {
                entry.translated_offset = @min(entry.translated_offset, source.buf.len);
                if (entry.translated_end == null) {
                    entry.translated_end = translatedCodepointEndOffset(source.buf, entry.translated_offset);
                }
            }
            try index.mapSource(source, file.source, group_start, group_end);
            group_start = group_end;
        }
    }

    fn mapSource(
        index: *TokenIndex,
        source: aro.Source,
        original: []const u8,
        group_start: usize,
        group_end: usize,
    ) aro.Source.OriginalLocationMapper.Error!void {
        var mapper = aro.Source.OriginalLocationMapper.init(source, original);
        index.source_map_count += 1;
        var start_index = group_start;
        var end_index = group_start;
        while (start_index < group_end or end_index < group_end) {
            const next_start = if (start_index < group_end)
                index.entries[start_index].translated_offset
            else
                std.math.maxInt(usize);
            const next_end = if (end_index < group_end)
                index.entries[end_index].translated_end.?
            else
                std.math.maxInt(usize);
            const translated_offset = @min(next_start, next_end);
            const boundary = try mapper.resolve(@intCast(translated_offset));

            while (start_index < group_end and
                index.entries[start_index].translated_offset == translated_offset) : (start_index += 1)
            {
                index.entries[start_index].original_start = originalPosition(boundary.after_splice);
            }
            while (end_index < group_end and
                index.entries[end_index].translated_end.? == translated_offset) : (end_index += 1)
            {
                index.entries[end_index].original_end = originalPosition(boundary.before_splice);
            }
        }
    }

    fn findRange(index: *const TokenIndex, file_id: u32, translated_offset: usize) ?MappedRange {
        const Key = struct { file_id: u32, offset: usize };
        const key: Key = .{ .file_id = file_id, .offset = translated_offset };
        const entry_index = std.sort.binarySearch(Entry, index.entries, key, struct {
            fn order(wanted: Key, entry: Entry) std.math.Order {
                const file_order = std.math.order(wanted.file_id, entry.file_id);
                if (file_order != .eq) return file_order;
                return std.math.order(wanted.offset, entry.translated_offset);
            }
        }.order) orelse return null;
        const entry = index.entries[entry_index];
        return .{
            .start = entry.original_start orelse return null,
            .end = entry.original_end orelse return null,
        };
    }
};

fn originalPosition(position: aro.Source.OriginalPosition) Position {
    return .{
        .line = position.line,
        .column = position.column,
        .byte_offset = position.byte_offset,
    };
}

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
    const mapped = token_index.findRange(file.id, location.byte_offset) orelse return startRange(file);
    return .{
        .file = file.id,
        .start = mapped.start,
        .end = mapped.end,
    };
}

fn translatedCodepointEndOffset(source: []const u8, offset: usize) usize {
    if (offset >= source.len or source[offset] == '\n') return offset;
    const sequence_len = std.unicode.utf8ByteSequenceLength(source[offset]) catch 1;
    return offset + @min(sequence_len, source.len - offset);
}

fn startRange(file: source_provider.SourceFile) Range {
    const end: Position = if (file.source.len == 0)
        .{ .line = 1, .column = 1, .byte_offset = 0 }
    else switch (file.source[0]) {
        '\n' => .{ .line = 2, .column = 1, .byte_offset = 1 },
        '\r' => .{
            .line = 2,
            .column = 1,
            .byte_offset = 1 + @as(u32, @intFromBool(file.source.len > 1 and file.source[1] == '\n')),
        },
        else => blk: {
            const sequence_len = std.unicode.utf8ByteSequenceLength(file.source[0]) catch 1;
            break :blk .{
                .line = 1,
                .column = 2,
                .byte_offset = @intCast(@min(sequence_len, file.source.len)),
            };
        },
    };
    return .{
        .file = file.id,
        .start = .{ .line = 1, .column = 1, .byte_offset = 0 },
        .end = end,
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
    try std.testing.expectEqual(@as(usize, 1), token_index.source_map_count);
    try std.testing.expectEqual(
        first_offset + "first_bad".len,
        token_index.findRange(1, first_offset).?.end.byte_offset,
    );
    try std.testing.expectEqual(
        second_offset + "second_bad".len,
        token_index.findRange(1, second_offset).?.end.byte_offset,
    );
}

test "original location mapper distinguishes both sides of a splice" {
    var comp = try aro.Compilation.init(.testing);
    defer comp.deinit();
    const original = "1\\\n+";
    const source = try comp.addSourceFromBuffer("splice.c", original);
    var mapper = aro.Source.OriginalLocationMapper.init(source, original);

    const start = try mapper.resolve(0);
    try std.testing.expectEqual(@as(u32, 0), start.after_splice.byte_offset);
    const splice = try mapper.resolve(1);
    try std.testing.expectEqual(@as(u32, 1), splice.before_splice.byte_offset);
    try std.testing.expectEqual(@as(u32, 3), splice.after_splice.byte_offset);
    try std.testing.expectEqual(@as(u32, 1), splice.before_splice.line);
    try std.testing.expectEqual(@as(u32, 2), splice.before_splice.column);
    try std.testing.expectEqual(@as(u32, 2), splice.after_splice.line);
    try std.testing.expectEqual(@as(u32, 1), splice.after_splice.column);
    const end = try mapper.resolve(2);
    try std.testing.expectEqual(@as(u32, original.len), end.after_splice.byte_offset);
}

test "original location mapper covers Aro newline translations exhaustively" {
    var aro_diagnostics: aro.Diagnostics = .{ .output = .ignore };
    var comp = try aro.Compilation.init(.testing);
    comp.diagnostics = &aro_diagnostics;
    defer comp.deinit();
    const alphabet = [_]u8{ '\r', '\n', ' ', '\\', 'a' };
    var original: [alphabet.len]u8 = @splat(alphabet[0]);
    var source_index: usize = 0;

    while (true) {
        var path_buffer: [32]u8 = undefined;
        const path = try std.fmt.bufPrint(&path_buffer, "mapping-{d}.c", .{source_index});
        const source = try comp.addSourceFromBuffer(path, &original);
        var mapper = aro.Source.OriginalLocationMapper.init(source, &original);
        var translated_offset: u32 = 0;
        while (translated_offset <= source.buf.len) : (translated_offset += 1) {
            const boundary = try mapper.resolve(translated_offset);
            try std.testing.expect(boundary.before_splice.byte_offset <= boundary.after_splice.byte_offset);
            try std.testing.expect(boundary.after_splice.byte_offset <= original.len);
            if (translated_offset == source.buf.len) {
                try std.testing.expectEqual(@as(u32, original.len), boundary.after_splice.byte_offset);
            }
        }
        source_index += 1;

        if (std.mem.allEqual(u8, &original, alphabet[alphabet.len - 1])) break;
        var digit = original.len;
        while (digit != 0) {
            digit -= 1;
            const alphabet_index = std.mem.indexOfScalar(u8, &alphabet, original[digit]).?;
            original[digit] = alphabet[(alphabet_index + 1) % alphabet.len];
            if (original[digit] != alphabet[0]) break;
        }
    }
    try std.testing.expectEqual(std.math.powi(usize, alphabet.len, alphabet.len) catch unreachable, source_index);
}

test "start range ends at an original UTF-8 boundary" {
    const file: source_provider.SourceFile = .{
        .id = 7,
        .path = "bom.c",
        .source = "\xEF\xBB\xBFint value;\n",
        .aro_id = null,
    };
    try std.testing.expectEqualDeep(Range{
        .file = 7,
        .start = .{ .line = 1, .column = 1, .byte_offset = 0 },
        .end = .{ .line = 1, .column = 2, .byte_offset = 3 },
    }, startRange(file));
}
