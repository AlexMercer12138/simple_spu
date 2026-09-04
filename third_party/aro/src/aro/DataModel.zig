const std = @import("std");

const DataModel = @This();

pointer_bits: u16,
maximum_natural_alignment: u16,
function_alignment: u8,
char_signedness: std.builtin.Signedness,

pub const merc32: DataModel = .{
    .pointer_bits = 32,
    .maximum_natural_alignment = 4,
    .function_alignment = 4,
    .char_signedness = .signed,
};

pub fn cTypeBitSize(_: DataModel, ty: std.Target.CType) u16 {
    return switch (ty) {
        .char => 8,
        .short, .ushort => 16,
        .int, .uint, .long, .ulong, .float => 32,
        .longlong, .ulonglong, .double, .longdouble => 64,
    };
}

pub fn cTypeAlignment(_: DataModel, ty: std.Target.CType) u16 {
    return switch (ty) {
        .char => 1,
        .short, .ushort => 2,
        else => 4,
    };
}
