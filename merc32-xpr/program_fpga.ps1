$ErrorActionPreference = 'Stop'

$scriptDirectory = $PSScriptRoot
$bitstream = Join-Path $scriptDirectory 'build/merc32_fpga_top.bit'
$programScript = Join-Path $scriptDirectory 'program_fpga.tcl'

if (-not (Test-Path -LiteralPath $bitstream -PathType Leaf)) {
    throw "bitstream does not exist; run build_fpga.ps1 first: $bitstream"
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

& $vivadoExecutable -mode batch -nolog -nojournal -source $programScript `
    -tclargs $bitstream
if ($LASTEXITCODE -ne 0) {
    throw "FPGA programming failed with exit code $LASTEXITCODE"
}

Write-Output "Programmed bitstream: $bitstream"
