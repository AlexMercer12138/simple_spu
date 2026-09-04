const std = @import("std");
const request = @import("request");

const valid_request =
    \\{"protocolVersion":1,"mainPath":"src/main.c","source":"int main(void) { return 0; }","standard":"c17","defines":{"A":"1","B":"2"},"includePaths":["include"],"virtualFiles":[{"path":"include/value.h","source":"#define VALUE 1\\n"}],"limits":{"fileBytes":4194304,"totalSourceBytes":33554432,"fileCount":4096,"includeDepth":32,"requestBytes":41943040,"resultBytes":67108864,"memoryBytes":134217728}}
;

test "hard limits guard every bounded resource" {
    try std.testing.expectEqual(@as(u32, 4 * 1024 * 1024), request.hard_limits.file_bytes);
    try std.testing.expectEqual(@as(u32, 32 * 1024 * 1024), request.hard_limits.total_source_bytes);
    try std.testing.expectEqual(@as(u32, 4096), request.hard_limits.file_count);
    try std.testing.expectEqual(@as(u32, 32), request.hard_limits.include_depth);
    try std.testing.expectEqual(@as(u32, 40 * 1024 * 1024), request.hard_limits.request_bytes);
    try std.testing.expectEqual(@as(u32, 64 * 1024 * 1024), request.hard_limits.result_bytes);
    try std.testing.expectEqual(@as(u32, 128 * 1024 * 1024), request.hard_limits.memory_bytes);
}

test "request parser accepts the future Task 8 host shape" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const parsed = try request.parse(arena.allocator(), valid_request);
    try std.testing.expectEqualStrings("src/main.c", parsed.main_path);
    try std.testing.expectEqualStrings("c17", parsed.standard);
    try std.testing.expectEqual(@as(usize, 2), parsed.defines.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.include_paths.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.virtual_files.len);
}

test "request parser rejects path traversal and platform paths" {
    inline for (.{ "../main.c", "/main.c", "src\\\\main.c", "src/./main.c", "C:/main.c" }) |bad_path| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        const text = try std.mem.replaceOwned(
            u8,
            std.testing.allocator,
            valid_request,
            "src/main.c",
            bad_path,
        );
        defer std.testing.allocator.free(text);
        try std.testing.expectError(error.InvalidPath, request.parse(arena.allocator(), text));
    }
}

test "request parser rejects duplicate virtual paths" {
    const duplicate =
        \\{"protocolVersion":1,"mainPath":"main.c","source":"int x;","standard":"c17","defines":{},"includePaths":[],"virtualFiles":[{"path":"a.h","source":""},{"path":"a.h","source":""}],"limits":{"fileBytes":4194304,"totalSourceBytes":33554432,"fileCount":4096,"includeDepth":32,"requestBytes":41943040,"resultBytes":67108864,"memoryBytes":134217728}}
    ;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectError(error.DuplicateVirtualFile, request.parse(arena.allocator(), duplicate));
}

test "request parser rejects define keys that are not sorted" {
    const unsorted =
        \\{"protocolVersion":1,"mainPath":"main.c","source":"int x;","standard":"c17","defines":{"B":"2","A":"1"},"includePaths":[],"virtualFiles":[],"limits":{"fileBytes":4194304,"totalSourceBytes":33554432,"fileCount":4096,"includeDepth":32,"requestBytes":41943040,"resultBytes":67108864,"memoryBytes":134217728}}
    ;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectError(error.UnsortedDefines, request.parse(arena.allocator(), unsorted));
}

test "request parser applies total source limit to the main file" {
    const main_over_total =
        \\{"protocolVersion":1,"mainPath":"main.c","source":"int x;","standard":"c17","defines":{},"includePaths":[],"virtualFiles":[],"limits":{"fileBytes":4194304,"totalSourceBytes":1,"fileCount":4096,"includeDepth":32,"requestBytes":41943040,"resultBytes":67108864,"memoryBytes":134217728}}
    ;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectError(error.ResourceLimit, request.parse(arena.allocator(), main_over_total));
}
