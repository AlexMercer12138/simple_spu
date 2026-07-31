param(
    [Parameter(Mandatory = $true)]
    [string]$Port,

    [ValidateRange(1, 3600)]
    [int]$Seconds = 12
)

$ErrorActionPreference = 'Stop'
$serialPort = [System.IO.Ports.SerialPort]::new(
    $Port,
    115200,
    [System.IO.Ports.Parity]::None,
    8,
    [System.IO.Ports.StopBits]::One
)
$serialPort.Handshake = [System.IO.Ports.Handshake]::None
$serialPort.ReadTimeout = 100
$serialPort.WriteTimeout = 1000

try {
    $serialPort.Open()
    $serialPort.DiscardInBuffer()
    $stimulus = [byte[]]@(0x55)
    $serialPort.Write($stimulus, 0, $stimulus.Length)

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $received = $serialPort.ReadExisting()
        if ($received.Length -ne 0) {
            [Console]::Write($received)
        }
        Start-Sleep -Milliseconds 20
    }
    [Console]::WriteLine()
} finally {
    if ($serialPort.IsOpen) {
        $serialPort.Close()
    }
    $serialPort.Dispose()
}
