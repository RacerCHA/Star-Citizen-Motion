# Changelog

## 0.2.1 — 2026-11-07

- Fix the observed Windows `EPERM` crash when replacing `runtime/status.json`. Diagnostic file write failures no longer stop the UDP bridge, receiver or MOZA TCP host; the next status tick retries.
- Read tray snapshots with delete sharing so the UI does not block atomic replacement by the writers.
- Run tray-owned receiver/bridge without the previous 24-hour limit. A menu pause or lack of telemetry does not trigger a restart.
- Restart only a failed bridge/receiver process with 1–30 second backoff. Keep a healthy receiver and the selected output toggles alive; manual Stop/Exit cancels recovery.
- Preserve MOZA freshness timeout: no stored forces are replayed during an idle menu or reconnect.
- Add Windows file-lock, clean/aborted TLS reconnect, idle resume and owned-process recovery regression tests on isolated ports.
- Include both Soft and Combat 3 presets in the portable package.

## Combat 3 preset — 2026-11-07

Third separate preset, derived from v0.3 Soft; application remains 0.2.0.

- Disable G Force, Deceleration (both enable fields), AoA reverse force and Elevator Weight after the user reported fore/aft pull interfering with combat aiming.
- Preserve Q-feel, Dynamic Pressure, base resistance, axis curves and all vibration settings, including Stick Shaker at 6.
- Preserve v0.2 and v0.3 Soft, using a separate Combat 3 name and UUID.
- Validate the JSON diff: five effect enable fields plus profile name, UUID and timestamp only. No bridge or SimHub changes.
- Add the new preset to portable packaging.
- Document the user-confirmed startup order: bridge → RSI Launcher → game.
- Local tools could not initialize; Combat 3 still needs import and live verification.

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
