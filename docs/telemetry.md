# Telemetry contract — v0.1.0

The receiver exposes raw mapped D-BOX events as JSON datagrams. Vehicle event 3 carries acceleration (meaning 40), angular velocity (35), and velocity (9). Body axes: X right, Y forward, Z up.

| SimHub field | Source / conversion |
|---|---|
| LocalSurgeMs2 | acceleration.y |
| LocalSwayMs2 | acceleration.x |
| LocalHeaveMs2 | acceleration.z |
| YawRateDegreesPerSecond | -angular_velocity.z × 180/π |
| PitchRateDegreesPerSecond | -angular_velocity.x × 180/π |
| RollRateDegreesPerSecond | +angular_velocity.y × 180/π |
| LocalVelocityForwardMps | velocity.y |
| LocalVelocityLateralMps | velocity.x |
| LocalVelocityUpMps | velocity.z |
| SpeedKmh | length(velocity) × 3.6 |
| VehicleName | meaning 30 of EnterVehicleConfig |

SimHub's angular convention is positive yaw to the right, pitch nose-down and roll right-wing-down. The packet is packed little-endian, 351 bytes, with a 55-byte standard header, ten float32 fields and a 256-byte UTF-8 vehicle name. `StarCitizen.simdef` and `SimHub-generated-contract.cs` are the contract. Game signature: `0x9844A282`; telemetry signature: `0x77903625`; protocol/layout 1 / 1.0; family Flight.

There is no smoothing, clipping, gain, gravity subtraction or resampling. Global simulation dt advances session time. Source stream changes and vehicle entry create new sessions; vehicle exit marks the session inactive. Replay mode sets `IsReplay=1` and is never used by the normal tray launcher.

## Limits of this baseline

- The source marks acceleration as including gravity and drag. SimHub's heave field expects gravity-free acceleration. The raw value is intentionally preserved; planetary gravity handling remains unvalidated.
- Absolute attitude angles are not supplied. Angular rates alone are not an absolute aircraft attitude solution.
- Weapon events are present in the source protocol but not mapped into this SimHub contract.
- No MOZA output is implemented in v0.1.0.
- A crash can produce a large raw peak. The flight capture contained a 5524.47 m/s² vector magnitude at an asteroid collision confirmed by the pilot. Hardware response is configured separately in SimHub.
- The telemetry application does not verify motion hardware readiness or enable actuators.
- The 24-hour worker lifetime and the game's reconnection behaviour are unchanged from the working baseline.

## Evidence

Test configuration: Windows 11, Star Citizen LIVE 4.10.2 / 12913470, AEGS Avenger Titan, HaptiSync Center 1.4.0, signed connector 2.0.0.20040, SimHub 9.13.3. The original capture yielded 18,390 vehicle frames over 279.57 s (65.78 Hz mean). All acceleration components matched the float32 SimHub output exactly. A two-minute replay sent 7,304 packets with no send errors, and the SimHub log reported valid received data. The user subsequently confirmed the integration worked.

Original captures, timestamps, session identifiers and local machine logs are intentionally not part of the public repository. These are historical observations; they are not a new clean-PC acceptance test.
