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

pub const Failure = aro.Compilation.SourceProvider.Failure;
const Resolution = aro.Compilation.SourceProvider.Resolution;

pub const SourceFile = struct {
    id: u32,
    path: []const u8,
    source: []const u8,
    aro_id: ?aro.Source.Id,
};

pub const SourceInstance = struct {
    aro_id: aro.Source.Id,
    canonical_file_id: u32,
    parent_instance: ?usize,
    included_from: ?aro.Source.ExpandedLocation,
};

pub const State = struct {
    allocator: std.mem.Allocator,
    limits: request.Limits,
    files: std.ArrayList(SourceFile) = .empty,
    instances: std.ArrayList(SourceInstance) = .empty,
    instance_lookup: std.AutoHashMapUnmanaged(aro.Source.Id, usize) = .empty,
    total_source_bytes: u64 = 0,

    pub fn init(allocator: std.mem.Allocator, limits: request.Limits) State {
        return .{ .allocator = allocator, .limits = limits };
    }

    pub fn deinit(state: *State) void {
        state.files.deinit(state.allocator);
        state.instances.deinit(state.allocator);
        state.instance_lookup.deinit(state.allocator);
    }

    pub fn recordMain(state: *State, path: []const u8, source: []const u8) !void {
        try state.files.append(state.allocator, .{
            .id = 1,
            .path = path,
            .source = source,
            .aro_id = null,
        });
        state.total_source_bytes = source.len;
    }

    pub fn seed(
        state: *State,
        main_path: []const u8,
        main_source: []const u8,
        virtual_files: []const request.VirtualFile,
    ) !void {
        try state.recordMain(main_path, main_source);
        for (virtual_files) |file| {
            try state.files.append(state.allocator, .{
                .id = @intCast(state.files.items.len + 1),
                .path = file.path,
                .source = file.source,
                .aro_id = null,
            });
            state.total_source_bytes += file.source.len;
        }
    }

    pub fn bindMain(state: *State, source: aro.Source) std.mem.Allocator.Error!void {
        std.debug.assert(state.files.items.len != 0);
        std.debug.assert(std.mem.eql(u8, state.files.items[0].path, source.path));
        state.files.items[0].aro_id = source.id;
        try state.addInstance(source.id, state.files.items[0].id, null, null);
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

    pub fn fileById(state: *const State, id: u32) ?SourceFile {
        if (id == 0 or id > state.files.items.len) return null;
        return state.files.items[id - 1];
    }

    pub fn fileForAroId(state: *const State, id: aro.Source.Id) ?SourceFile {
        if (state.instance_lookup.get(id)) |instance_index| {
            return state.fileById(state.instances.items[instance_index].canonical_file_id);
        }
        for (state.files.items) |file| {
            if (file.aro_id == id) return file;
        }
        return null;
    }

    pub fn instanceIndex(state: *const State, id: aro.Source.Id) ?usize {
        return state.instance_lookup.get(id);
    }

    fn findIndex(state: *const State, path: []const u8) ?usize {
        for (state.files.items, 0..) |file, index| {
            if (std.mem.eql(u8, file.path, path)) return index;
        }
        return null;
    }

    fn register(
        state: *State,
        comp: *aro.Compilation,
        index: usize,
        kind: aro.Source.Kind,
        include_site: ?aro.Source.ExpandedLocation,
    ) std.mem.Allocator.Error!Resolution {
        const file = &state.files.items[index];
        const canonical_source = if (file.aro_id) |id|
            comp.getSource(id)
        else source: {
            const aro_source = comp.addSourceFromBuffer(file.path, file.source) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return .{ .failure = .invalid_record },
            };
            file.aro_id = aro_source.id;
            break :source aro_source;
        };
        const site = include_site orelse return .{ .source = canonical_source };
        const alias_id = try comp.addSourceAlias(canonical_source.id, canonical_source.path, kind);
        const parent_instance = state.instanceIndex(site.source_id);
        try state.addInstance(alias_id, file.id, parent_instance, site);
        return .{ .source = comp.getSource(alias_id) };
    }

    fn addInstance(
        state: *State,
        aro_id: aro.Source.Id,
        canonical_file_id: u32,
        parent_instance: ?usize,
        included_from: ?aro.Source.ExpandedLocation,
    ) std.mem.Allocator.Error!void {
        try state.instances.ensureUnusedCapacity(state.allocator, 1);
        try state.instance_lookup.ensureUnusedCapacity(state.allocator, 1);
        const index = state.instances.items.len;
        state.instances.appendAssumeCapacity(.{
            .aro_id = aro_id,
            .canonical_file_id = canonical_file_id,
            .parent_instance = parent_instance,
            .included_from = included_from,
        });
        state.instance_lookup.putAssumeCapacityNoClobber(aro_id, index);
    }

    fn resolveSource(
        context: *anyopaque,
        comp: *aro.Compilation,
        candidate: []const u8,
        kind: aro.Source.Kind,
        include_site: ?aro.Source.ExpandedLocation,
    ) std.mem.Allocator.Error!Resolution {
        const state: *State = @ptrCast(@alignCast(context));
        if (state.findIndex(candidate)) |index| {
            return state.register(comp, index, kind, include_site);
        }
        if (candidate.len > std.math.maxInt(u32)) {
            return .{ .failure = .invalid_record };
        }
        const capacity_usize = std.math.add(
            usize,
            4 + @as(usize, state.limits.file_bytes),
            candidate.len,
        ) catch {
            return .{ .failure = .invalid_record };
        };
        if (capacity_usize > std.math.maxInt(u32)) {
            return .{ .failure = .invalid_record };
        }
        const buffer = try state.allocator.alloc(u8, capacity_usize);
        const encoded_len = host.resolve(
            @intCast(@intFromPtr(candidate.ptr)),
            @intCast(candidate.len),
            @intCast(@intFromPtr(buffer.ptr)),
            @intCast(buffer.len),
        );
        if (encoded_len == -1) return .not_found;
        if (encoded_len == -2) return .{ .failure = .host_read };
        if (encoded_len < 4) return .{ .failure = .invalid_record };
        const record_len: usize = @intCast(encoded_len);
        if (record_len > buffer.len) return .{ .failure = .invalid_record };
        const record = buffer[0..record_len];
        const path_len = std.mem.readInt(u32, record[0..4], .little);
        if (path_len > record.len - 4) return .{ .failure = .invalid_record };
        const path_end = 4 + @as(usize, path_len);
        const canonical_path = record[4..path_end];
        const source = record[path_end..];
        if (!std.unicode.utf8ValidateSlice(canonical_path) or !std.unicode.utf8ValidateSlice(source)) {
            return .{ .failure = .invalid_utf8 };
        }
        if (!request.validateLogicalPath(canonical_path)) {
            return .{ .failure = .invalid_path };
        }
        if (source.len > state.limits.file_bytes) {
            return .{ .failure = .file_bytes };
        }
        if (state.findIndex(canonical_path)) |index| {
            return state.register(comp, index, kind, include_site);
        }
        if (state.files.items.len >= state.limits.file_count) {
            return .{ .failure = .file_count };
        }
        if (state.total_source_bytes + source.len > state.limits.total_source_bytes) {
            return .{ .failure = .total_source_bytes };
        }

        try state.files.append(state.allocator, .{
            .id = @intCast(state.files.items.len + 1),
            .path = canonical_path,
            .source = source,
            .aro_id = null,
        });
        state.total_source_bytes += source.len;
        return state.register(comp, state.files.items.len - 1, kind, include_site);
    }
};
