const std = @import("std");

pub const Id = packed struct(u32) {
    index: enum(u31) {
        unused = std.math.maxInt(u31) - 0,
        generated = std.math.maxInt(u31) - 1,
        _,
    },
    alias: bool = false,

    pub const unused: Id = .{ .index = .unused };
    pub const generated: Id = .{ .index = .generated };
};

/// Classifies the file for line marker output in -E mode
pub const Kind = enum {
    /// regular file
    user,
    /// Included from a system include directory
    system,
    /// Included from an "implicit extern C" directory
    extern_c_system,
};

pub const Location = struct {
    id: Id = .unused,
    byte_offset: u32 = 0,
    line: u32 = 0,

    pub fn eql(a: Location, b: Location) bool {
        return a.id == b.id and a.byte_offset == b.byte_offset and a.line == b.line;
    }

    pub fn expand(loc: Location, comp: *const @import("Compilation.zig")) ExpandedLocation {
        const source = comp.getSource(loc.id);
        return source.lineCol(loc);
    }
};

pub const ExpandedLocation = struct {
    source_id: Id,
    byte_offset: u32,
    path: []const u8,
    line: []const u8,
    line_no: u32,
    col: u32,
    width: u32,
    end_with_splice: bool,
    kind: Kind,
};

const Source = @This();

path: []const u8,
buf: [:0]const u8,
id: Id,
/// Stable identity shared by aliases of the same physical source.
canonical_id: ?Id = null,
/// each entry represents a byte position within `buf` where a backslash+newline was deleted
/// from the original raw buffer. The same position can appear multiple times if multiple
/// consecutive splices happened. Guaranteed to be non-decreasing
splice_locs: []const u32,
kind: Kind,

// Path of the umbrella framework. Slice of `path`.
umbrella_framework_path: ?[]const u8 = null,

pub fn canonicalId(source: Source) Id {
    return source.canonical_id orelse source.id;
}

pub fn lineCol(source: Source, loc: Location) ExpandedLocation {
    var start: usize = 0;
    // find the start of the line which is either a newline or a splice
    if (std.mem.findScalarLast(u8, source.buf[0..loc.byte_offset], '\n')) |some| start = some + 1;
    const splice_index: u32 = for (source.splice_locs, 0..) |splice_offset, i| {
        if (splice_offset > start) {
            if (splice_offset < loc.byte_offset) {
                start = splice_offset;
                break @as(u32, @intCast(i)) + 1;
            }
            break @intCast(i);
        }
    } else @intCast(source.splice_locs.len);
    var i: usize = start;
    var col: u32 = 1;
    var width: u32 = 0;

    while (i < loc.byte_offset) : (col += 1) { // TODO this is still incorrect, but better
        const len = std.unicode.utf8ByteSequenceLength(source.buf[i]) catch {
            i += 1;
            continue;
        };
        const slice = source.buf[i..];
        if (len > slice.len) {
            break;
        }
        const cp = switch (len) {
            1 => slice[0],
            2 => std.unicode.utf8Decode2(slice[0..2].*),
            3 => std.unicode.utf8Decode3(slice[0..3].*),
            4 => std.unicode.utf8Decode4(slice[0..4].*),
            else => unreachable,
        } catch {
            i += 1;
            continue;
        };
        width += codepointWidth(cp);
        i += len;
    }

    // find the end of the line which is either a newline, EOF or a splice
    var nl = source.buf.len;
    var end_with_splice = false;
    if (std.mem.findScalar(u8, source.buf[start..], '\n')) |some| nl = some + start;
    if (source.splice_locs.len > splice_index and nl > source.splice_locs[splice_index] and source.splice_locs[splice_index] > start) {
        end_with_splice = true;
        nl = source.splice_locs[splice_index];
    }
    return .{
        .source_id = loc.id,
        .byte_offset = loc.byte_offset,
        .path = source.path,
        .line = source.buf[start..nl],
        .line_no = loc.line,
        .col = col,
        .width = width,
        .end_with_splice = end_with_splice,
        .kind = source.kind,
    };
}

pub const OriginalPosition = struct {
    byte_offset: u32,
    line: u32,
    column: u32,
};

pub const OriginalBoundary = struct {
    before_splice: OriginalPosition,
    after_splice: OriginalPosition,
};

/// Resolves monotonically increasing translated offsets against the original
/// source bytes without retaining a per-byte translation map.
pub const OriginalLocationMapper = struct {
    pub const Error = error{InvalidSourceMapping};

    source: Source,
    original: []const u8,
    original_index: usize = 0,
    translated_index: u32 = 0,
    splice_index: usize = 0,
    position: OriginalPosition = .{ .byte_offset = 0, .line = 1, .column = 1 },
    boundary_before: OriginalPosition = .{ .byte_offset = 0, .line = 1, .column = 1 },

    pub fn init(source: Source, original: []const u8) OriginalLocationMapper {
        var mapper: OriginalLocationMapper = .{
            .source = source,
            .original = original,
        };
        if (std.mem.startsWith(u8, original, "\xEF\xBB\xBF")) {
            mapper.advanceOriginalTo(3);
            mapper.boundary_before = mapper.position;
        }
        return mapper;
    }

    pub fn resolve(mapper: *OriginalLocationMapper, translated_offset: u32) Error!OriginalBoundary {
        if (translated_offset < mapper.translated_index or translated_offset > mapper.source.buf.len) {
            return error.InvalidSourceMapping;
        }
        while (mapper.translated_index < translated_offset) {
            try mapper.consumeSplices();
            try mapper.consumeTranslatedByte();
            mapper.boundary_before = mapper.position;
        }
        const before_splice = mapper.boundary_before;
        try mapper.consumeSplices();
        return .{
            .before_splice = before_splice,
            .after_splice = mapper.position,
        };
    }

    fn consumeSplices(mapper: *OriginalLocationMapper) Error!void {
        while (mapper.splice_index < mapper.source.splice_locs.len) {
            const splice_offset = mapper.source.splice_locs[mapper.splice_index];
            if (splice_offset < mapper.translated_index) return error.InvalidSourceMapping;
            if (splice_offset != mapper.translated_index) break;

            const end = try mapper.spliceEnd();
            mapper.advanceOriginalTo(end);
            mapper.splice_index += 1;
        }
    }

    fn spliceEnd(mapper: *const OriginalLocationMapper) Error!usize {
        if (mapper.original_index >= mapper.original.len) return error.InvalidSourceMapping;
        var index = mapper.original_index;
        if (mapper.original[index] == '\\') {
            index += 1;
            while (index < mapper.original.len and isSpliceWhitespace(mapper.original[index])) : (index += 1) {}
        }
        if (index >= mapper.original.len) return error.InvalidSourceMapping;
        return switch (mapper.original[index]) {
            '\n' => index + 1,
            '\r' => index + 1 + @intFromBool(index + 1 < mapper.original.len and mapper.original[index + 1] == '\n'),
            else => error.InvalidSourceMapping,
        };
    }

    fn consumeTranslatedByte(mapper: *OriginalLocationMapper) Error!void {
        if (mapper.translated_index >= mapper.source.buf.len or mapper.original_index >= mapper.original.len) {
            return error.InvalidSourceMapping;
        }
        const translated = mapper.source.buf[mapper.translated_index];
        const original = mapper.original[mapper.original_index];
        const original_end = if (original == translated)
            mapper.original_index + 1
        else if (original == '\r' and translated == '\n')
            mapper.original_index + 1 + @intFromBool(
                mapper.original_index + 1 < mapper.original.len and
                    mapper.original[mapper.original_index + 1] == '\n',
            )
        else
            return error.InvalidSourceMapping;
        mapper.advanceOriginalTo(original_end);
        mapper.translated_index += 1;
    }

    fn advanceOriginalTo(mapper: *OriginalLocationMapper, end: usize) void {
        while (mapper.original_index < end) {
            const byte = mapper.original[mapper.original_index];
            switch (byte) {
                '\r' => {
                    mapper.original_index += 1;
                    if (mapper.original_index < end and mapper.original[mapper.original_index] == '\n') {
                        mapper.original_index += 1;
                    }
                    mapper.position.line += 1;
                    mapper.position.column = 1;
                },
                '\n' => {
                    mapper.original_index += 1;
                    mapper.position.line += 1;
                    mapper.position.column = 1;
                },
                else => {
                    mapper.original_index += 1;
                    if (byte & 0xC0 != 0x80) mapper.position.column += 1;
                },
            }
        }
        mapper.position.byte_offset = @intCast(mapper.original_index);
    }

    fn isSpliceWhitespace(byte: u8) bool {
        return switch (byte) {
            '\t', '\x0B', '\x0C', ' ' => true,
            else => false,
        };
    }
};

fn codepointWidth(cp: u32) u32 {
    return switch (cp) {
        0x1100...0x115F,
        0x2329,
        0x232A,
        0x2E80...0x303F,
        0x3040...0x3247,
        0x3250...0x4DBF,
        0x4E00...0xA4C6,
        0xA960...0xA97C,
        0xAC00...0xD7A3,
        0xF900...0xFAFF,
        0xFE10...0xFE19,
        0xFE30...0xFE6B,
        0xFF01...0xFF60,
        0xFFE0...0xFFE6,
        0x1B000...0x1B001,
        0x1F200...0x1F251,
        0x20000...0x3FFFD,
        0x1F300...0x1F5FF,
        0x1F900...0x1F9FF,
        => 2,
        else => 1,
    };
}
