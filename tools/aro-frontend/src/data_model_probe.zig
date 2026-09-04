const std = @import("std");
const aro = @import("aro");

pub const target = "merc32";
pub const abi = "merc32-c-v1";
pub const data_model = "merc32-ilp32";
pub const output = "merc32\nmerc32-c-v1\nmerc32-ilp32\n";

pub fn initCompilation(
    allocator: std.mem.Allocator,
    arena: std.mem.Allocator,
    diagnostics: *aro.Diagnostics,
) !aro.Compilation {
    var comp = try aro.Compilation.init(.{
        .gpa = allocator,
        .arena = arena,
        .io = std.testing.io,
        .diagnostics = diagnostics,
        .environ_map = null,
        .add_default_pragma_handlers = false,
        .data_model = .merc32,
    });
    comp.langopts.standard = .c17;
    comp.target.os.tag = .freestanding;
    return comp;
}
