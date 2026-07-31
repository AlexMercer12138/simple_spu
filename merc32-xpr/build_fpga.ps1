$ErrorActionPreference = 'Stop'

$scriptDirectory = $PSScriptRoot
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory '..')).Path
$compilerDirectory = Join-Path $repositoryRoot 'merc32-vsce'
$firmwareBuilder = Join-Path $scriptDirectory 'firmware/build_firmware.js'
$firmwareOutput = Join-Path $scriptDirectory 'build/firmware'
$buildScript = Join-Path $scriptDirectory 'build_fpga.tcl'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "command failed with exit code ${LASTEXITCODE}: $Command"
    }
}

$vivadoCommand = Get-Command 'vivado.bat' -ErrorAction SilentlyContinue
if ($null -eq $vivadoCommand) {
    $knownVivado = 'D:/DevelopSoftware/Xilinx/Vivado/2020.2/bin/vivado.bat'
    if (-not (Test-Path -LiteralPath $knownVivado -PathType Leaf)) {
        throw 'vivado.bat was not found in PATH or at the known Vivado 2020.2 path'
    }
    $vivadoExecutable = $knownVivado
} else {
    $vivadoExecutable = $vivadoCommand.Source
}

Invoke-CheckedCommand -Command 'npm.cmd' -Arguments @(
    '--prefix', $compilerDirectory, 'run', 'compile'
)
Invoke-CheckedCommand -Command 'node.exe' -Arguments @(
    $firmwareBuilder, '--output-dir', $firmwareOutput
)
Invoke-CheckedCommand -Command $vivadoExecutable -Arguments @(
    '-mode', 'batch', '-nolog', '-nojournal', '-source', $buildScript
)

$bitstream = Join-Path $scriptDirectory 'build/merc32_fpga_top.bit'
if (-not (Test-Path -LiteralPath $bitstream -PathType Leaf)) {
    throw "Vivado exited successfully but the bitstream is missing: $bitstream"
}

Write-Output "FPGA bitstream: $bitstream"
