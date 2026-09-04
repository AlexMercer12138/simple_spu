const std = @import("std");
const aro = @import("aro");

pub const target = "merc32";
pub const abi = "merc32-c-v1";
pub const data_model = "merc32-ilp32";
pub const output = "merc32\nmerc32-c-v1\nmerc32-ilp32\n";

pub const BackingTarget = enum {
    x86_64_linux,
    avr_cpu_linux,
    darwin_variant,
};

pub fn initCompilation(
    allocator: std.mem.Allocator,
    arena: std.mem.Allocator,
    diagnostics: *aro.Diagnostics,
) !aro.Compilation {
    return initCompilationForBackingTarget(allocator, arena, diagnostics, .merc32, .x86_64_linux);
}

pub fn initCompilationForBackingTarget(
    allocator: std.mem.Allocator,
    arena: std.mem.Allocator,
    diagnostics: *aro.Diagnostics,
    selected_data_model: ?aro.DataModel,
    backing_target: BackingTarget,
) !aro.Compilation {
    var comp = try aro.Compilation.init(.{
        .gpa = allocator,
        .arena = arena,
        .io = std.testing.io,
        .diagnostics = diagnostics,
        .environ_map = null,
        .add_default_pragma_handlers = false,
        .data_model = selected_data_model,
    });
    errdefer comp.deinit();

    const target_triple: []const u8 = switch (backing_target) {
        .x86_64_linux, .avr_cpu_linux => "x86_64-linux-gnu",
        .darwin_variant => "aarch64-macos-none",
    };
    comp.target = .fromZigTarget(try resolveTarget(target_triple));
    comp.target.vendor = switch (backing_target) {
        .x86_64_linux, .avr_cpu_linux => .pc,
        .darwin_variant => .apple,
    };

    switch (backing_target) {
        .x86_64_linux => {},
        .avr_cpu_linux => comp.target.cpu = (try resolveTarget("avr-freestanding-none")).cpu,
        .darwin_variant => {
            comp.darwin_target_variant = .fromZigTarget(try resolveTarget("x86_64-ios-simulator"));
            comp.darwin_target_variant.?.vendor = .apple;
        },
    }

    comp.langopts.standard = .c17;
    return comp;
}

fn resolveTarget(triple: []const u8) !std.Target {
    const query = try std.Target.Query.parse(.{ .arch_os_abi = triple });
    return std.zig.system.resolveTargetQuery(std.testing.io, query);
}
