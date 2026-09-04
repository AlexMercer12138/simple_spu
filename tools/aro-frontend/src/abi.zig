const std = @import("std");
const request = @import("request.zig");
const serializer = @import("serializer.zig");

pub const protocol_version: u32 = 1;

pub const State = struct {
    capped_allocator: CappedAllocator = .{
        .child = std.heap.wasm_allocator,
        .limit = request.hard_limits.memory_bytes,
    },
    arena: ?std.heap.ArenaAllocator = null,
    request_buffer: []u8 = &.{},
    result: []const u8 = &.{},
    has_request: bool = false,
    emergency_result: [4096]u8 = undefined,

    pub fn reset(state: *State) void {
        if (state.arena) |arena| arena.deinit();
        state.* = .{};
    }

    pub fn allocator(state: *State) std.mem.Allocator {
        if (state.arena == null) {
            state.arena = std.heap.ArenaAllocator.init(state.capped_allocator.allocator());
        }
        return state.arena.?.allocator();
    }

    pub fn allocRequest(state: *State, len: u32) u32 {
        state.reset();
        if (len == 0 or len > request.hard_limits.request_bytes) return 0;
        state.request_buffer = state.allocator().alloc(u8, len) catch return 0;
        state.has_request = true;
        return @intCast(@intFromPtr(state.request_buffer.ptr));
    }

    pub fn lowerMemoryLimit(state: *State, limit: u32) bool {
        state.capped_allocator.limit = limit;
        return state.capped_allocator.live_bytes <= limit;
    }

    pub fn requestSlice(state: *State, ptr: u32, len: u32) ?[]const u8 {
        if (!state.has_request or len != state.request_buffer.len) return null;
        if (ptr != @as(u32, @intCast(@intFromPtr(state.request_buffer.ptr)))) return null;
        return state.request_buffer;
    }

    pub fn setResult(state: *State, bytes: []const u8) void {
        state.result = bytes;
    }

    pub fn setFailureResult(
        state: *State,
        build_id: []const u8,
        status: serializer.Status,
        code: []const u8,
        message: []const u8,
    ) void {
        state.result = serializer.failureEnvelope(
            &state.emergency_result,
            build_id,
            status,
            code,
            message,
        );
    }

    pub fn resultPtr(state: *const State) u32 {
        return if (state.result.len == 0) 0 else @intCast(@intFromPtr(state.result.ptr));
    }

    pub fn resultLen(state: *const State) u32 {
        return @intCast(state.result.len);
    }
};

const CappedAllocator = struct {
    child: std.mem.Allocator,
    limit: usize,
    live_bytes: usize = 0,

    fn allocator(capped: *CappedAllocator) std.mem.Allocator {
        return .{
            .ptr = capped,
            .vtable = &.{
                .alloc = alloc,
                .resize = resize,
                .remap = remap,
                .free = free,
            },
        };
    }

    fn alloc(
        context: *anyopaque,
        len: usize,
        alignment: std.mem.Alignment,
        return_address: usize,
    ) ?[*]u8 {
        const capped: *CappedAllocator = @ptrCast(@alignCast(context));
        if (len > capped.limit -| capped.live_bytes) return null;
        const memory = capped.child.rawAlloc(len, alignment, return_address) orelse return null;
        capped.live_bytes += len;
        return memory;
    }

    fn resize(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        return_address: usize,
    ) bool {
        const capped: *CappedAllocator = @ptrCast(@alignCast(context));
        if (new_len > memory.len and new_len - memory.len > capped.limit -| capped.live_bytes) return false;
        if (!capped.child.rawResize(memory, alignment, new_len, return_address)) return false;
        capped.adjustLiveBytes(memory.len, new_len);
        return true;
    }

    fn remap(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        return_address: usize,
    ) ?[*]u8 {
        const capped: *CappedAllocator = @ptrCast(@alignCast(context));
        if (new_len > memory.len and new_len - memory.len > capped.limit -| capped.live_bytes) return null;
        const remapped = capped.child.rawRemap(memory, alignment, new_len, return_address) orelse return null;
        capped.adjustLiveBytes(memory.len, new_len);
        return remapped;
    }

    fn free(
        context: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        return_address: usize,
    ) void {
        const capped: *CappedAllocator = @ptrCast(@alignCast(context));
        std.debug.assert(memory.len <= capped.live_bytes);
        capped.live_bytes -= memory.len;
        capped.child.rawFree(memory, alignment, return_address);
    }

    fn adjustLiveBytes(capped: *CappedAllocator, old_len: usize, new_len: usize) void {
        if (new_len >= old_len) {
            capped.live_bytes += new_len - old_len;
        } else {
            capped.live_bytes -= old_len - new_len;
        }
    }
};
