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
pwsh -NoProfile -File .\New-LocalCertificate.ps1 -OutDir .\receiver\runtime\cert
node .\tests\receiver.mjs
node .\tests\receiver.mjs --no-record
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\installer.ps1
```

The receiver tests use dynamically allocated loopback ports and synthetic vectors. They do not send data to SimHub or motion hardware. They test TLS trust/hostname, protobuf/gRPC framing, stream-local registration, UDP mapping, heartbeat responses and omitted credential fields. `--no-record` also verifies that normal tray operation creates no capture file. Certificates and test fixtures are created under ignored `runtime` directories.

The installer test exercises its actual atomic write, scope checking and rollback functions against a workspace fixture. It never modifies an installed D-BOX instance and does not require administrator privileges.

`tests/encoder.mjs` checks the generated packet layout, signed axes/rates, full-scale crash values, session transitions, invalid input and replay flags. The historical real-flight comparison is summarized in [telemetry.md](telemetry.md); private flight recordings are not required for the public tests.

## Working tree

- `TrayApp.cs`: tray UI and owned-process lifetime.
- `bridge.mjs`: JSON input and SimHub UDP output; optional explicit replay for development.
- `simhub-packet.mjs`: event state and binary encoding.
- `receiver/`: TLS/gRPC receiver and protobuf codec.
- `StarCitizen.simdef`: registered game definition, family Flight.
- `Apply-DBox.ps1`: version-checked transactional setup and rollback.
- `New-LocalCertificate.ps1`: machine-local certificate generation.
- `upstream/`: preserved schema source and provenance in the notices file.

The app's own SHA-256 and the release archive SHA-256 can be checked in the generated `SHA256SUMS.txt`. Rebuilding with a different compiler may change the executable hash.
