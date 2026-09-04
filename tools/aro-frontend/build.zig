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

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });
    const bridge_options = b.addOptions();
    bridge_options.addOption(
        []const u8,
        "bridge_build_id",
        "merc32-aro-v1-58502f21fa9c03d3e484c17e806b72e3fd6cc7bf40320b5b304988615bdfe009",
    );
    const bridge = b.addExecutable(.{
        .name = "aro-merc32",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bridge.zig"),
            .target = wasm_target,
            .optimize = .small,
            .single_threaded = true,
            .imports = &.{ .{
                .name = "aro",
                .module = aro_dependency.module("aro"),
            }, .{
                .name = "bridge_options",
                .module = bridge_options.createModule(),
            } },
        }),
    });
    bridge.entry = .disabled;
    bridge.export_memory = true;
    bridge.max_memory = 128 * 1024 * 1024;
    bridge.root_module.export_symbol_names = &.{
        "merc32_alloc",
        "merc32_analyze",
        "merc32_result_ptr",
        "merc32_result_len",
        "merc32_reset",
        "merc32_protocol_version",
        "merc32_build_id_ptr",
        "merc32_build_id_len",
    };

    const request_module = b.createModule(.{
        .root_source_file = b.path("src/request.zig"),
    });
    const bridge_contract_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("tests/bridge_contract.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{
                .name = "request",
                .module = request_module,
            }},
        }),
    });
    const run_bridge_contract_tests = b.addRunArtifact(bridge_contract_tests);
    const serializer_contract_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/serializer.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{
                .name = "aro",
                .module = aro_dependency.module("aro"),
            }},
        }),
    });
    const run_serializer_contract_tests = b.addRunArtifact(serializer_contract_tests);
    const run_bridge_host = b.addSystemCommand(&.{ "node", "tests/bridge-host.js" });
    run_bridge_host.addArtifactArg(bridge);

    const test_bridge = b.step("test-bridge", "Run the bounded WASM bridge contract tests");
    test_bridge.dependOn(&run_bridge_contract_tests.step);
    test_bridge.dependOn(&run_serializer_contract_tests.step);
    test_bridge.dependOn(&run_bridge_host.step);
}
