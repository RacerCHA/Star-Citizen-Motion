# Changelog

## 0.1.0 — 2026-11-06

Initial Star Citizen → SimHub baseline, before MOZA integration.

- Local D-BOX LiveMotion TLS/gRPC receiver and JSON UDP output.
- SimHub External Sim definition with the Flight family.
- Direct acceleration, angular-rate and velocity mapping without filtering or clipping.
- Windows tray application with a blue lightning icon, live status, start/stop and single-instance operation.
- Per-machine certificate generation, verified D-BOX connector setup and rollback.
- Source build, portable release packaging and isolated protocol/installer tests.

The telemetry implementation is the same as the tested local baseline. Public packaging adds relative certificate paths, version metadata and clean-install instructions. MOZA output is not included in this version.
