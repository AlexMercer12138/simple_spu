if {[llength $argv] != 1} {
    error "usage: program_fpga.tcl <bitstream>"
}

set bitstream [file normalize [lindex $argv 0]]
if {![file isfile $bitstream]} {
    error "bitstream does not exist: $bitstream"
}

set programming_result [catch {
    open_hw_manager
    connect_hw_server
    open_hw_target

    set target_device ""
    set detected_parts [list]
    foreach device [get_hw_devices -quiet] {
        set part [get_property PART $device]
        lappend detected_parts $part
        if {$target_device eq "" &&
            [string match -nocase {xc7a200t*} $part]} {
            set target_device $device
        }
    }

    if {$target_device eq ""} {
        error "no xc7a200t device found; detected devices: $detected_parts"
    }

    current_hw_device $target_device
    refresh_hw_device -update_hw_probes false $target_device
    set_property PROGRAM.FILE $bitstream $target_device
    program_hw_devices $target_device
    refresh_hw_device -update_hw_probes false $target_device
    puts "PROGRAM PASS"
} programming_message programming_options]

catch {close_hw_manager}
if {$programming_result != 0} {
    return -options $programming_options $programming_message
}
