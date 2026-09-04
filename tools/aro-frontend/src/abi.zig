const std = @import("std");
const request = @import("request.zig");

pub const protocol_version: u32 = 1;

pub const State = struct {
    arena: std.heap.ArenaAllocator = .init(std.heap.wasm_allocator),
    request_buffer: []u8 = &.{},
    result: []const u8 = &.{},
    has_request: bool = false,

    pub fn reset(state: *State) void {
        state.arena.deinit();
        state.* = .{};
    }

    pub fn allocRequest(state: *State, len: u32) u32 {
        state.reset();
        if (len == 0 or len > request.hard_limits.request_bytes) return 0;
        state.request_buffer = state.arena.allocator().alloc(u8, len) catch return 0;
        state.has_request = true;
        return @intCast(@intFromPtr(state.request_buffer.ptr));
    }

    pub fn requestSlice(state: *State, ptr: u32, len: u32) ?[]const u8 {
        if (!state.has_request or len != state.request_buffer.len) return null;
        if (ptr != @as(u32, @intCast(@intFromPtr(state.request_buffer.ptr)))) return null;
        return state.request_buffer;
    }

    pub fn setResult(state: *State, bytes: []const u8) void {
        state.result = bytes;
    }

    pub fn resultPtr(state: *const State) u32 {
        return if (state.result.len == 0) 0 else @intCast(@intFromPtr(state.result.ptr));
    }

    pub fn resultLen(state: *const State) u32 {
        return @intCast(state.result.len);
    }
};
