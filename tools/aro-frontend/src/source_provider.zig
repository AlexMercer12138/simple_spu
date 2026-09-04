const std = @import("std");
const aro = @import("aro");
const request = @import("request.zig");

const host = struct {
    extern "merc32_source" fn resolve(
        candidate_ptr: u32,
        candidate_len: u32,
        result_ptr: u32,
        result_capacity: u32,
    ) callconv(.c) i32;
};

pub const Failure = enum {
    none,
    host_read,
    invalid_record,
    invalid_utf8,
    invalid_path,
    file_bytes,
    total_source_bytes,
    file_count,
};

pub const SourceFile = struct {
    id: u32,
    path: []const u8,
    source: []const u8,
    parent_path: ?[]const u8,
};

pub const State = struct {
    allocator: std.mem.Allocator,
    limits: request.Limits,
    files: std.ArrayList(SourceFile) = .empty,
    total_source_bytes: u64 = 0,
    failure: Failure = .none,

    pub fn init(allocator: std.mem.Allocator, limits: request.Limits) State {
        return .{ .allocator = allocator, .limits = limits };
    }

    pub fn recordMain(state: *State, path: []const u8, source: []const u8) !void {
        try state.files.append(state.allocator, .{
            .id = 1,
            .path = path,
            .source = source,
            .parent_path = null,
        });
        state.total_source_bytes = source.len;
    }

    pub fn provider(state: *State) aro.Compilation.SourceProvider {
        return .{
            .context = state,
            .resolve = resolveSource,
        };
    }

    pub fn find(state: *const State, path: []const u8) ?SourceFile {
        for (state.files.items) |file| {
            if (std.mem.eql(u8, file.path, path)) return file;
        }
        return null;
    }

    fn resolveSource(
        context: *anyopaque,
        comp: *aro.Compilation,
        candidate: []const u8,
        kind: aro.Source.Kind,
        includer_path: []const u8,
    ) std.mem.Allocator.Error!?aro.Source {
        const state: *State = @ptrCast(@alignCast(context));
        if (candidate.len > std.math.maxInt(u32)) {
            state.failure = .invalid_record;
            return null;
        }
        const capacity_usize = std.math.add(
            usize,
            4 + @as(usize, state.limits.file_bytes),
            candidate.len,
        ) catch {
            state.failure = .invalid_record;
            return null;
        };
        if (capacity_usize > std.math.maxInt(u32)) {
            state.failure = .invalid_record;
            return null;
        }
        const buffer = state.allocator.alloc(u8, capacity_usize) catch {
            state.failure = .host_read;
            return null;
        };
        const encoded_len = host.resolve(
            @intCast(@intFromPtr(candidate.ptr)),
            @intCast(candidate.len),
            @intCast(@intFromPtr(buffer.ptr)),
            @intCast(buffer.len),
        );
        if (encoded_len == -1) return null;
        if (encoded_len == -2) {
            state.failure = .host_read;
            return null;
        }
        if (encoded_len < 0 or encoded_len > buffer.len or encoded_len < 4) {
            state.failure = .invalid_record;
            return null;
        }
        const record = buffer[0..@intCast(encoded_len)];
        const path_len = std.mem.readInt(u32, record[0..4], .little);
        if (path_len > record.len - 4) {
            state.failure = .invalid_record;
            return null;
        }
        const canonical_path = record[4 .. 4 + path_len];
        const source = record[4 + path_len ..];
        if (!std.unicode.utf8ValidateSlice(canonical_path) or !std.unicode.utf8ValidateSlice(source)) {
            state.failure = .invalid_utf8;
            return null;
        }
        if (!request.validateLogicalPath(canonical_path)) {
            state.failure = .invalid_path;
            return null;
        }
        if (source.len > state.limits.file_bytes) {
            state.failure = .file_bytes;
            return null;
        }
        if (state.find(canonical_path)) |_| return comp.addSourceFromBuffer(canonical_path, source) catch null;
        if (state.files.items.len >= state.limits.file_count) {
            state.failure = .file_count;
            return null;
        }
        if (state.total_source_bytes + source.len > state.limits.total_source_bytes) {
            state.failure = .total_source_bytes;
            return null;
        }

        const aro_source = comp.addSourceFromBuffer(canonical_path, source) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                state.failure = .invalid_record;
                return null;
            },
        };
        state.files.append(state.allocator, .{
            .id = @intCast(state.files.items.len + 1),
            .path = aro_source.path,
            .source = source,
            .parent_path = includer_path,
        }) catch return error.OutOfMemory;
        state.total_source_bytes += source.len;
        _ = kind;
        return aro_source;
    }
};
