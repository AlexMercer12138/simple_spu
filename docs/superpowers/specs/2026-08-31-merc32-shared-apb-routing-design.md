# MERC32 Shared APB Routing Design

## 1. Purpose

Remove redundant PLB/LB channels for built-in APB peripherals. All built-in
APB peripherals share one PLB router target, one local-bus channel, one
`lb2apb` bridge, and one generated APB interconnect. External interfaces remain
independent PLB targets and retain their protocol-specific bridges.

This changes generated integration topology only. It does not change the SoC
configuration schema, peripheral address map, software output, catalog format,
or public external-interface ports.

## 2. Confirmed Root Cause

The current top already instantiates only one `lb2apb` bridge. The redundancy
comes from planning every built-in APB peripheral as an independent PLB router
endpoint. The generated top ORs all per-peripheral LB request signals into the
single bridge and broadcasts the bridge response back to every per-peripheral
router channel.

Current topology:

```text
CPU PLB
  -> PLB router
       -> uart0 LB --+
       -> gpio0 LB --+--> one lb2apb -> APB interconnect -> peripherals
       -> timer0 LB -+
       -> external endpoint LB -> protocol bridge or external local bus
```

The per-peripheral LB channels carry no independent bridge or response logic;
they exist only because PLB routing and APB decoding currently use the same
endpoint list.

## 3. Target Topology

```text
CPU PLB
  -> PLB router
       -> builtin_apb LB
            -> one lb2apb
                 -> generated APB interconnect
                      -> uart0
                      -> gpio0
                      -> timer0
                      -> other built-in APB peripherals
       -> external endpoint 0 LB -> its protocol bridge or external LB ports
       -> external endpoint 1 LB -> its protocol bridge or external LB ports
```

When no built-in APB peripheral exists, the plan contains no `builtin_apb`
target and the generated top contains no `lb2apb` or APB interconnect. When one
or more built-in APB peripherals exist, exactly one `builtin_apb` target and
exactly one bridge/interconnect pair are generated.

## 4. Planning Model

Separate addressable configuration records from PLB router targets.

- `peripherals` remains the ordered list used to instantiate built-in modules
  and generate APB decode selections.
- `externalInterfaces` remains the ordered list used to expose or bridge
  external protocols.
- Router targets become explicit planned objects with a stable name and one or
  more address ranges.
- Each external interface produces one router target containing its single
  configured range.
- All built-in APB peripherals collectively produce one `builtin_apb` router
  target whose ranges are the exact peripheral ranges.

The grouped target must store the individual ranges. It must not use one
minimum-to-maximum bounding window. Exact range membership preserves sparse APB
maps and allows an external endpoint to occupy an address gap between two
built-in APB peripherals without being shadowed.

Router targets are sorted deterministically by their lowest range base address.
The existing configuration validation continues to reject actual overlapping
peripheral and external ranges before planning.

## 5. PLB Router Generation

The generated PLB router exposes one LB request/response port set per router
target, not per address range. Decode logic selects a target when the master
address falls inside any range owned by that target.

For `builtin_apb`, the condition is the OR of every built-in peripheral range.
For an external interface, the condition contains its one configured range.
The existing single-outstanding-request state machine, response selection,
address/data forwarding, reset behavior, and no-match behavior remain unchanged.

Only the number and grouping of target ports change. With built-in peripherals
and no external endpoints, the router has exactly one target channel named
`builtin_apb`.

## 6. Integration Top Generation

The generated top declares one `builtin_apb_router_*` LB signal set and connects
it directly to `builtin_apb_bridge_inst`.

- Remove request OR reduction across peripheral router channels.
- Remove response fan-out assignments to peripheral router channels.
- Drive `lb2apb` request, address, strobe, and write data from the grouped
  `builtin_apb_router_*` signals.
- Return bridge data and valid directly to the grouped router response signals.
- Keep one generated APB interconnect. It receives the full 32-bit APB address
  and selects each peripheral using that peripheral's original absolute range.
- Keep existing peripheral instances, parameters, ports, interrupts, and APB
  response wiring unchanged.

External endpoints continue to use their own `<name>_router_*` signals and the
existing `lb2apb`, `lb2axi_lite`, `lb2wbc`, `lb2avalon`, `lb2drp`, or direct
local-bus integration path.

## 7. Generated Files and Compatibility

The generated file set remains structurally the same:

- `<project>.v`
- `generated/<project>_plb_router.v`
- `generated/<project>_apb_interconnect.v` when built-in peripherals exist
- one `rtl/bridge/lb2apb.v` asset when either the built-in APB subsystem or an
  external APB endpoint requires it
- existing peripheral and external-protocol assets

Generated RTL bytes are intentionally changed because the integration topology
changes. Configuration JSON, address constants, software headers/linker output,
external top-level ports, peripheral module interfaces, and catalog resources
remain compatible.

Generated code remains Verilog-2005. No SystemVerilog syntax or new runtime
dependency is introduced.

## 8. Validation and Error Handling

Existing validation remains authoritative for duplicate names, address overlap,
alignment, address width, generated symbol collisions, and protocol legality.
The synthetic target name is reserved by generated-symbol validation so a user
instance cannot collide with `builtin_apb` signals or instance names.

Planning must not produce a grouped APB target with zero ranges. Emitter entry
points continue to consume frozen validated plans and must render deterministically.

## 9. Testing

### 9.1 Planner and emitter contracts

- A configuration with multiple built-in APB peripherals produces one
  `builtin_apb` router target containing all exact peripheral ranges.
- A configuration with built-in APB peripherals plus external endpoints produces
  one grouped APB target plus one target per external endpoint.
- Sparse built-in peripheral ranges remain separate decode clauses.
- An external endpoint placed in a gap between built-in peripheral ranges is
  routed to the external target, not the grouped APB target.
- The top contains one `builtin_apb_bridge_inst`, one APB interconnect instance,
  and no `<peripheral>_router_*` signals.
- The APB interconnect continues to decode every original peripheral range.
- A configuration without built-in peripherals emits no grouped target, bridge,
  or APB interconnect.

### 9.2 RTL behavior

Extend the generated RTL matrix with a multi-peripheral transaction test that
performs accesses to at least two built-in APB peripheral ranges through the
single grouped LB channel. Include a sparse map with an external endpoint in an
address gap and prove the generated PLB router selects the correct target for
all three address classes.

Retain stateful-router, reset, interrupt-controller, external-protocol, generated
file-list, collision, and deterministic-emission coverage.

### 9.3 Regression suites

Run configuration, generator, generated RTL, VS Code SoC unit, Webview/session,
resource closure, extension-host, and VSIX packaging tests. Re-run the browser
workflow because dependency and address summaries consume the planned topology,
even though the editor layout itself is unchanged.

## 10. Acceptance Criteria

1. Any nonzero number of built-in APB peripherals creates exactly one PLB/LB
   router target for the internal APB subsystem.
2. Exactly one built-in `lb2apb` instance feeds the generated APB interconnect.
3. No per-peripheral `*_router_*` LB signals are generated for built-in APB
   peripherals.
4. External interfaces retain independent PLB targets and bridges.
5. Sparse APB maps and external endpoints between APB ranges route correctly.
6. Peripheral APB selection, responses, interrupts, parameters, and top-level
   ports remain correct.
7. Config schema and generated software/address metadata remain unchanged.
8. Generated RTL remains deterministic Verilog-2005 and passes the complete RTL
   simulation matrix.

## 11. Out of Scope

- Combining multiple external APB endpoints behind the built-in APB interconnect.
- Changing the SoC JSON schema or address allocator.
- Changing peripheral register maps or APB module implementations.
- Supporting multiple PLB masters or multiple outstanding PLB transactions.
- Replacing existing protocol bridge RTL.
