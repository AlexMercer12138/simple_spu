const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const aro_dependency = b.dependency("aro", .{
        .target = target,
        .optimize = optimize,
    });

    const data_model_probe = b.createModule(.{
        .root_source_file = b.path("src/data_model_probe.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{
            .name = "aro",
            .module = aro_dependency.module("aro"),
        }},
    });
    const data_model_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("tests/data_model.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{ .{
                .name = "aro",
                .module = aro_dependency.module("aro"),
            }, .{
                .name = "data_model_probe",
                .module = data_model_probe,
            } },
        }),
    });

    const test_data_model = b.step("test-data-model", "Run the MERC32 Aro data-model conformance matrix");
    test_data_model.dependOn(&b.addRunArtifact(data_model_tests).step);
}
