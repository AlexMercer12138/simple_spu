# Task 2: Opaque Module and Protocol Catalog

## Result

Implemented the Node-only MERC32 catalog loader and committed JSON descriptors
for the eight initial APB module types plus the six external-interface
protocols. The loader treats RTL as opaque metadata only and returns immutable
descriptor maps.

Commit: `f03f3292a2aec03c0455eb5099d072f7a57707fe`

## Files

- `merc32-vsce/src/soc/catalog.ts`
- `merc32-vsce/src/soc/index.ts`
- `merc32-vsce/resources/catalog/modules/apb_can.json`
- `merc32-vsce/resources/catalog/modules/apb_gpio.json`
- `merc32-vsce/resources/catalog/modules/apb_i2c.json`
- `merc32-vsce/resources/catalog/modules/apb_intc.json`
- `merc32-vsce/resources/catalog/modules/apb_qspi.json`
- `merc32-vsce/resources/catalog/modules/apb_sdio.json`
- `merc32-vsce/resources/catalog/modules/apb_timer.json`
- `merc32-vsce/resources/catalog/modules/apb_uart.json`
- `merc32-vsce/resources/catalog/protocols.json`
- `merc32-vsce/scripts/test-soc-config.js`

## RED/GREEN

RED: `npm run test:soc:config` failed as intended with
`TypeError: loadCatalog is not a function` after tests were added before the
loader existed.

GREEN: after implementation, all catalog assertions pass, including duplicate
module type/port, missing RTL, invalid parameter default, unknown dynamic
width parameter, unknown fields, absolute/traversal path rejection, and a
component-by-component Windows case-mismatch fixture.

## Interface verification sources

Public declarations inspected:

- `rtl/apb_uart/apb_uart.v`
- `rtl/apb_gpio/apb_gpio.v`
- `rtl/apb_timer/apb_timer.v`
- `rtl/apb_i2c/apb_i2c.v`
- `rtl/apb_qspi/apb_qspi.v`
- `rtl/apb_sdio/apb_sdio.v`
- `rtl/apb_can/apb_can.v`
- `rtl/bridge/lb2apb.v`
- `rtl/bridge/lb2axi_lite.v`
- `rtl/bridge/lb2wbc.v`
- `rtl/bridge/lb2avalon.v`
- `rtl/bridge/lb2drp.v`

Public INTC contract source only (the protected RTL was never opened):
`rtl/sim/apb_intc_tb.v` and the locked SoC-generator design/spec.

FIFO constraints were checked against the public module manuals: UART 8..128,
I2C 8..128, QSPI 8..128, SDIO 8..512, and CAN FIFOs power-of-two with minimum
8.

## Verification

- `npm run test:soc:config` — pass
- `npm run test:soc` — pass
- `npm test` — pass
- `git diff --check` — pass

## Self-review

Confirmed descriptors expose exactly eight module types, only `apb_intc` is
non-repeatable, all initial APB mappings use 4096-byte size/alignment, bridge
port suffixes match public bridge declarations, dynamic address-port widths use
each bridge's address-width parameter, runtime maps have no mutating methods,
and loader paths neither escape the asset root nor tolerate case mismatches.

## Concern

The committed catalog names packaged `rtl/...` logical paths. Those asset files
are intentionally absent until the later resource-preparation task. Tests use
temporary opaque assets to exercise the current loader; Task 8 will populate
the real packaged resource tree and test it end-to-end.

## Fix Round 1

RED: the focused catalog suite first failed because the DRP descriptor exposed
`addr/en/we/rdy/in/out`, rather than `lb2drp`'s public
`drp_addr/drp_en/drp_we/drp_rdy/drp_in/drp_out` ports. Independent runtime
probes then recorded `CS_MAX=undefined`, `FOREACH_CLEAR=function`, and
`PROTOCOLS_CASE=ACCEPTED` for the remaining three reported defects.

GREEN: DRP descriptors now use the exact public port names, QSPI `CS_COUNT` is
restricted to 1..16, the map facade passes itself (without `clear`/`set`) as
the `forEach` callback map and preserves eight modules, and
`catalog/protocols.json` is checked component-by-component for exact casing
before it is read. The regression suite includes assertions for all four.
