# Changelog

## Preset v0.3 Soft — 2026-11-07

Preset-only revision; application remains 0.2.0.

- Separate AB9 profile UUID; v0.2 preserved.
- Stick Shaker intensity 24 → 6 (25% of previous).
- Directional effect strength settings reduced to approximately 70%, with integer rounding.
- Activation thresholds, frequency, base centering/damping, weapons and engine vibration unchanged.
- Prepared from the published v0.2 preset; local import was not possible because PC tooling failed to initialize.

## 0.2.0 — 2026-11-07

- Independent SimHub and MOZA switches sharing one live receiver.
- Owned DCS.exe TCP host, automatic lifetime, source-age timeout, stop and reconnect support.
- DCS-compatible acceleration, angular rates, scaled speed, gear, engine/boost and weapon-event mapping.
- Separate Star Citizen AB9 preset based on Elite v4, with jet effects enabled; unavailable channels remain neutral.
- Explicit documentation of measured data, virtual aircraft cues and unavailable damage state.
- Isolated encoder, TCP, timeout and output-switching tests. No live AB9 flight validation claimed yet.

## 0.1.0 — 2026-11-06

Initial Star Citizen → SimHub baseline, before MOZA integration.

- Local D-BOX LiveMotion TLS/gRPC receiver and JSON UDP output.
- SimHub External Sim definition with the Flight family.
- Direct acceleration, angular-rate and velocity mapping without filtering or clipping.
- Windows tray application with a blue lightning icon, live status, start/stop and single-instance operation.
- Per-machine certificate generation, verified D-BOX connector setup and rollback.
- Source build, portable release packaging and isolated protocol/installer tests.

The telemetry implementation is the same as the tested local baseline. Public packaging adds relative certificate paths, version metadata and clean-install instructions. MOZA output is not included in this version.
