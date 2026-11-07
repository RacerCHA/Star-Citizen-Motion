# Build and validation

The frozen v0.1.0 baseline targets SimHub. Keep MOZA development in later commits/tags.

## Build

Run `Build.cmd`, or `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build.ps1`.
The Windows .NET Framework compiler builds the tray executable; no NuGet packages are needed. Node.js uses only built-in modules. `Build.ps1` creates local `settings.json` from the public example without overwriting an existing configuration.

The release package is produced with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Package.ps1`. It includes the EXE, runtime source, setup/rollback scripts, documentation and tests. Its settings use `runtime\cert`, generated individually by the recipient. Packaging uses an explicit allowlist: private keys, logs, flight recordings, D-BOX binaries and local settings are excluded.

## Tests

Run in PowerShell 7 from the project directory:

```powershell
node .\tests\encoder.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build.ps1
node .\tests\moza-encoder.mjs
node .\tests\moza-host.mjs
node .\tests\outputs.mjs
pwsh -NoProfile -File .\New-LocalCertificate.ps1 -OutDir .\receiver\runtime\cert
node .\tests\receiver.mjs
node .\tests\receiver.mjs --no-record
node .\tests\recovery.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\worker-recovery.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\installer.ps1
```

The receiver tests use dynamically allocated loopback ports and synthetic vectors. They do not send data to SimHub or motion hardware. They test TLS trust/hostname, protobuf/gRPC framing, stream-local registration, UDP mapping, heartbeat responses and omitted credential fields. `--no-record` also verifies that normal tray operation creates no capture file. Certificates and test fixtures are created under ignored `runtime` directories.

The installer test exercises its actual atomic write, scope checking and rollback functions against a workspace fixture. It never modifies an installed D-BOX instance and does not require administrator privileges.

`recovery.mjs` holds actual Windows file handles that deny atomic replacement and verifies continued UDP/TLS traffic, recovered valid JSON, indefinite (`--duration 0`) operation, idle resume and new TLS sessions after clean and aborted connections. `moza-host.mjs` also locks the TCP host's status file while sending fresh packets, then verifies the stale-data disconnect still works. `worker-recovery.ps1` tests the real process supervisor with disposable child processes: crash recovery, bounded backoff, preserving a healthy sibling, and cancellation on manual stop. All network tests use ephemeral ports and the TCP test executable is not named DCS.

These accelerated tests do not claim an hour-long live Star Citizen AFK session has been tested. The listener accepts a new connection if the game's connector initiates one; it cannot force the game to reconnect.

`tests/encoder.mjs` checks the generated packet layout, signed axes/rates, full-scale crash values, session transitions, invalid input and replay flags. The historical real-flight comparison is summarized in [telemetry.md](telemetry.md); private flight recordings are not required for the public tests.

## Working tree

- `TrayApp.cs`: tray UI and owned-process lifetime.
- `bridge.mjs`: JSON input and SimHub UDP output; optional explicit replay for development.
- `simhub-packet.mjs`: event state and binary encoding.
- `moza-packet.mjs`: pilot-gated DCS text conversion and effect equivalents.
- `DcsHost.cs`: owned loopback TCP server compiled as DCS.exe; freshness watchdog and reconnect.
- `presets/`: separate AB9 profile derived from the existing Elite v4 profile.
- `receiver/`: TLS/gRPC receiver and protobuf codec.
- `StarCitizen.simdef`: registered game definition, family Flight.
- `Apply-DBox.ps1`: version-checked transactional setup and rollback.
- `New-LocalCertificate.ps1`: machine-local certificate generation.
- `upstream/`: preserved schema source and provenance in the notices file.

The app's own SHA-256 and the release archive SHA-256 can be checked in the generated `SHA256SUMS.txt`. Rebuilding with a different compiler may change the executable hash.

The MOZA host test runs under the non-DCS name `SCMozaHostTest.exe` on ephemeral ports, so it cannot be selected by Cockpit. `outputs.mjs` also uses ephemeral ports. `flight-audit.mjs <private capture.jsonl>` evaluates a recording offline without opening any sockets. Never replay a crash recording into the live MOZA/SimHub ports to run software tests.
