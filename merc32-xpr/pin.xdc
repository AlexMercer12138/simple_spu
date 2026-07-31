set_property -dict { PACKAGE_PIN W19   IOSTANDARD LVCMOS33 } [get_ports { sys_clk }];
set_property -dict { PACKAGE_PIN Y19   IOSTANDARD LVCMOS33 } [get_ports { sys_rst_n }];
set_property -dict { PACKAGE_PIN W17   IOSTANDARD LVCMOS33 } [get_ports { uart_rx }];
set_property -dict { PACKAGE_PIN V17   IOSTANDARD LVCMOS33 } [get_ports { uart_tx }];
set_property -dict { PACKAGE_PIN K19   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { i2c_scl }];
set_property -dict { PACKAGE_PIN J22   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { i2c_sda }];
set_property -dict { PACKAGE_PIN R16   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { key_n[0] }];
set_property -dict { PACKAGE_PIN P15   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { key_n[1] }];
set_property -dict { PACKAGE_PIN T20   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { key_n[2] }];
set_property -dict { PACKAGE_PIN Y18   IOSTANDARD LVCMOS33 PULLUP TRUE } [get_ports { key_n[3] }];
set_property -dict { PACKAGE_PIN N20   IOSTANDARD LVCMOS33 } [get_ports { led_n[0] }];
set_property -dict { PACKAGE_PIN M20   IOSTANDARD LVCMOS33 } [get_ports { led_n[1] }];
set_property -dict { PACKAGE_PIN N22   IOSTANDARD LVCMOS33 } [get_ports { led_n[2] }];
set_property -dict { PACKAGE_PIN M22   IOSTANDARD LVCMOS33 } [get_ports { led_n[3] }];
set_property -dict { PACKAGE_PIN AA18  IOSTANDARD LVCMOS33 } [get_ports { beep }];

create_clock -period 20.000 -name sys_clk [get_ports { sys_clk }];
