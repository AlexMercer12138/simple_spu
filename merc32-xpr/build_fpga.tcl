set script_dir [file dirname [file normalize [info script]]]
set repo_root [file normalize [file join $script_dir ..]]
set build_dir [file join $script_dir build]
set project_dir [file join $build_dir vivado]
set report_dir [file join $build_dir reports]
set firmware_mem [file join $build_dir firmware peripheral_test.mem]
set constraint_file [file join $script_dir pin.xdc]
set output_bitstream [file join $build_dir merc32_fpga_top.bit]

set rtl_sources [list \
    [file join $repo_root rtl debug jtag_debug.v] \
    [file join $repo_root rtl cpu divider.v] \
    [file join $repo_root rtl cpu core.v] \
    [file join $repo_root rtl bridge lb2apb.v] \
    [file join $repo_root rtl cpu MERC32_top.v] \
    [file join $repo_root rtl misc spram.v] \
    [file join $repo_root rtl misc sync_fifo.v] \
    [file join $repo_root rtl bridge apb4_interconnect.v] \
    [file join $repo_root rtl uart apb_uart.v] \
    [file join $repo_root rtl i2c i2c_master_lite.v] \
    [file join $repo_root rtl i2c i2c_slave.v] \
    [file join $repo_root rtl i2c apb_i2c.v] \
    [file join $repo_root rtl gpio apb_gpio.v] \
    [file join $repo_root rtl timer timer_channel.v] \
    [file join $repo_root rtl timer apb_timer.v] \
    [file join $repo_root rtl fpga merc32_soc.v] \
    [file join $repo_root rtl fpga merc32_fpga_top.v]]

foreach source_file [concat $rtl_sources [list $firmware_mem $constraint_file]] {
    if {![file isfile $source_file]} {
        error "required build input does not exist: $source_file"
    }
}

file mkdir $build_dir
file mkdir $report_dir
if {[file exists $project_dir]} {
    file delete -force $project_dir
}

create_project merc32_fpga $project_dir -part xc7a200tfbg484-2
set_property target_language Verilog [current_project]
add_files -norecurse $rtl_sources
add_files -norecurse $firmware_mem
set_property file_type {Memory Initialization Files} [get_files $firmware_mem]
add_files -fileset constrs_1 -norecurse $constraint_file
set_property top merc32_fpga_top [current_fileset]
update_compile_order -fileset sources_1

launch_runs synth_1 -jobs 4
wait_on_run synth_1
set synth_status [get_property STATUS [get_runs synth_1]]
puts "SYNTH STATUS: $synth_status"
if {![string match {*Complete*} $synth_status]} {
    error "synthesis did not complete: $synth_status"
}

launch_runs impl_1 -to_step write_bitstream -jobs 4
wait_on_run impl_1
set impl_status [get_property STATUS [get_runs impl_1]]
puts "IMPL STATUS: $impl_status"
if {![string match {*Complete*} $impl_status]} {
    error "implementation did not complete: $impl_status"
}

open_run impl_1
report_timing_summary -file [file join $report_dir timing_summary.rpt]
report_utilization -file [file join $report_dir utilization.rpt]
report_drc -file [file join $report_dir drc.rpt]

set timing_paths [get_timing_paths -delay_type max -max_paths 1 -nworst 1]
if {[llength $timing_paths] == 0} {
    error "no setup timing path was reported"
}
set wns [get_property SLACK [lindex $timing_paths 0]]
puts "WNS: $wns ns"
if {$wns < 0.0} {
    error "setup timing failed with WNS $wns ns"
}

set drc_errors [get_drc_violations -quiet -filter {SEVERITY == Error}]
set drc_error_count [llength $drc_errors]
puts "DRC ERROR COUNT: $drc_error_count"
if {$drc_error_count != 0} {
    error "implementation has $drc_error_count DRC error(s)"
}

set run_directory [get_property DIRECTORY [get_runs impl_1]]
set generated_bitstream [file join $run_directory merc32_fpga_top.bit]
if {![file isfile $generated_bitstream]} {
    error "generated bitstream does not exist: $generated_bitstream"
}
file copy -force $generated_bitstream $output_bitstream
puts "BITSTREAM: $output_bitstream"
puts "FPGA BUILD PASS"

close_project
