const std = @import("std");

pub const Limits = struct {
    file_bytes: u32 = 4 * 1024 * 1024,
    total_source_bytes: u32 = 32 * 1024 * 1024,
    file_count: u32 = 4096,
    include_depth: u32 = 32,
    request_bytes: u32 = 40 * 1024 * 1024,
    result_bytes: u32 = 64 * 1024 * 1024,
    memory_bytes: u32 = 128 * 1024 * 1024,
};

pub const hard_limits = Limits{};

pub const Define = struct {
    name: []const u8,
    value: []const u8,
};

pub const VirtualFile = struct {
    path: []const u8,
    source: []const u8,
};

pub const Request = struct {
    protocol_version: u32,
    main_path: []const u8,
    source: []const u8,
    standard: []const u8,
    defines: []const Define,
    include_paths: []const []const u8,
    virtual_files: []const VirtualFile,
    limits: Limits,
};

const RawLimits = struct {
    fileBytes: u32,
    totalSourceBytes: u32,
    fileCount: u32,
    includeDepth: u32,
    requestBytes: u32,
    resultBytes: u32,
    memoryBytes: u32,
};

const RawVirtualFile = struct {
    path: []const u8,
    source: []const u8,
};

const RawRequest = struct {
    protocolVersion: u32,
    mainPath: []const u8,
    source: []const u8,
    standard: []const u8,
    defines: std.json.ArrayHashMap([]const u8),
    includePaths: []const []const u8,
    virtualFiles: []const RawVirtualFile,
    limits: RawLimits,
};

pub const ParseError = error{
    InvalidJson,
    InvalidRequest,
    InvalidProtocol,
    InvalidStandard,
    InvalidLimits,
    InvalidPath,
    DuplicateVirtualFile,
    UnsortedDefines,
    ResourceLimit,
} || std.mem.Allocator.Error;

pub fn parse(allocator: std.mem.Allocator, json: []const u8) ParseError!Request {
    if (json.len > hard_limits.request_bytes) return error.ResourceLimit;
    const raw = std.json.parseFromSliceLeaky(RawRequest, allocator, json, .{}) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.SyntaxError, error.UnexpectedEndOfInput => return error.InvalidJson,
        else => return error.InvalidRequest,
    };

    const protocol_version = raw.protocolVersion;
    if (protocol_version != 1) return error.InvalidProtocol;
    const main_path = raw.mainPath;
    if (!validateLogicalPath(main_path)) return error.InvalidPath;
    const source = raw.source;
    const standard = raw.standard;
    if (!std.mem.eql(u8, standard, "c17")) return error.InvalidStandard;
    const limits = try parseLimits(raw.limits);

    if (json.len > limits.request_bytes or
        source.len > limits.file_bytes or
        source.len > limits.total_source_bytes)
    {
        return error.ResourceLimit;
    }
    const defines = try parseDefines(allocator, raw.defines);
    const include_paths = try parseIncludePaths(allocator, raw.includePaths);
    const virtual_files = try parseVirtualFiles(
        allocator,
        raw.virtualFiles,
        main_path,
        limits,
        source.len,
    );

    return .{
        .protocol_version = protocol_version,
        .main_path = main_path,
        .source = source,
        .standard = standard,
        .defines = defines,
        .include_paths = include_paths,
        .virtual_files = virtual_files,
        .limits = limits,
    };
}

pub fn validateLogicalPath(path: []const u8) bool {
    if (path.len == 0 or path[0] == '/' or path[path.len - 1] == '/') return false;
    if (std.mem.indexOfScalar(u8, path, '\\') != null or std.mem.indexOfScalar(u8, path, 0) != null) return false;
    if (path.len >= 2 and std.ascii.isAlphabetic(path[0]) and path[1] == ':') return false;
    var segments = std.mem.splitScalar(u8, path, '/');
    while (segments.next()) |segment| {
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return false;
    }
    return std.unicode.utf8ValidateSlice(path);
}

fn parseLimits(raw: RawLimits) ParseError!Limits {
    const limits: Limits = .{
        .file_bytes = raw.fileBytes,
        .total_source_bytes = raw.totalSourceBytes,
        .file_count = raw.fileCount,
        .include_depth = raw.includeDepth,
        .request_bytes = raw.requestBytes,
        .result_bytes = raw.resultBytes,
        .memory_bytes = raw.memoryBytes,
    };
    if (limits.file_bytes == 0 or limits.file_bytes > hard_limits.file_bytes or
        limits.total_source_bytes == 0 or limits.total_source_bytes > hard_limits.total_source_bytes or
        limits.file_count == 0 or limits.file_count > hard_limits.file_count or
        limits.include_depth == 0 or limits.include_depth > hard_limits.include_depth or
        limits.request_bytes == 0 or limits.request_bytes > hard_limits.request_bytes or
        limits.result_bytes == 0 or limits.result_bytes > hard_limits.result_bytes or
        limits.memory_bytes == 0 or limits.memory_bytes > hard_limits.memory_bytes)
    {
        return error.InvalidLimits;
    }
    return limits;
}

fn parseDefines(
    allocator: std.mem.Allocator,
    raw: std.json.ArrayHashMap([]const u8),
) ParseError![]const Define {
    var defines = try allocator.alloc(Define, raw.map.count());
    var iterator = raw.map.iterator();
    var index: usize = 0;
    var previous: ?[]const u8 = null;
    while (iterator.next()) |entry| : (index += 1) {
        const name = entry.key_ptr.*;
        if (name.len == 0 or !std.unicode.utf8ValidateSlice(name)) return error.InvalidRequest;
        if (previous) |prior| {
            if (std.mem.order(u8, prior, name) != .lt) return error.UnsortedDefines;
        }
        defines[index] = .{ .name = name, .value = entry.value_ptr.* };
        previous = name;
    }
    return defines;
}

fn parseIncludePaths(allocator: std.mem.Allocator, raw: []const []const u8) ParseError![]const []const u8 {
    var paths = try allocator.alloc([]const u8, raw.len);
    for (raw, 0..) |path, index| {
        if (!validateLogicalPath(path)) return error.InvalidPath;
        paths[index] = path;
    }
    return paths;
}

fn parseVirtualFiles(
    allocator: std.mem.Allocator,
    raw: []const RawVirtualFile,
    main_path: []const u8,
    limits: Limits,
    main_source_len: usize,
) ParseError![]const VirtualFile {
    if (raw.len + 1 > limits.file_count) return error.ResourceLimit;
    var files = try allocator.alloc(VirtualFile, raw.len);
    var seen: std.StringHashMapUnmanaged(void) = .empty;
    defer seen.deinit(allocator);
    try seen.put(allocator, main_path, {});

    var total: u64 = main_source_len;
    for (raw, 0..) |item, index| {
        const path = item.path;
        const source = item.source;
        if (!validateLogicalPath(path)) return error.InvalidPath;
        if (seen.contains(path)) return error.DuplicateVirtualFile;
        try seen.put(allocator, path, {});
        if (source.len > limits.file_bytes) return error.ResourceLimit;
        total += source.len;
        if (total > limits.total_source_bytes) return error.ResourceLimit;
        files[index] = .{ .path = path, .source = source };
    }
    return files;
}
