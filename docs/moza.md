# MOZA Cockpit / AB9

The optional MOZA output uses the text protocol of MOZA's installed DCS exporter. It does not require the MOZA SDK, a DCS installation, injected code or game memory access. One receiver feeds both SimHub and MOZA; neither output depends on the other being enabled.

## Start and stop

- Start in this order: `StarCitizenTelemetry.exe` → RSI Launcher → Star Citizen. The user confirmed that starting the bridge before the launcher resolves the waiting-for-telemetry condition on the tested PC. If the launcher/game was already running without telemetry, close both and repeat this order. SimHub starts enabled; MOZA requires its separate button on each app launch.
- Load `presets/StarCitizen-AB9-Combat-3.preset` in Cockpit: Local Preset → Import → Import → Load Now. It targets AB9 / DCS World / A-10C II / Telemetry FFB.
- Enable MOZA in the lightning app. It starts its own `DCS World/bin/DCS.exe`. Disable MOZA to stop that helper while keeping the game connection and SimHub alive.
- Do not run the Elite bridge or the actual DCS simultaneously: both use the same process identity and TCP channel. The app refuses this conflict and never terminates another DCS process.
- Cockpit needs its DCS integration configured to connect locally. The tested PC uses TCP **3476**, confirmed in `Saved Games/DCS/Scripts/MOZA/MOZA.lua`. MOZA's bundled default may be **1234**. Match `MozaTcpPort` to the port in your configured export script; do not replace existing Elite scripts unnecessarily. Configuration on a fresh Cockpit install without any existing DCS integration has not been validated.
- The helper receives internal JSON on UDP 56063 and serves MOZA on TCP 3476, both loopback only. The tray displays an actual TCP connection and sent-frame count when Cockpit connects.
- The app does not change Cockpit's configured DCS executable path. If your Cockpit build requires a game location, point its DCS entry to the included `DCS World` directory. This discovery step still needs verification on fresh installations.

The helper accepts only fresh pilot data. A role other than pilot, leaving the vehicle, missing frames/role updates for 350 ms, stopping MOZA or closing the app causes `export_stop,true;` and disconnect. It also exits if its owning tray process disappears. The expiry sent over UDP preserves the age of the original source, so a repeated stale frame cannot keep effects alive. Both the encoder and TCP helper enforce freshness.

## Mapping

The ship is represented as **A-10C_2**, the same model used by the Elite preset. This chooses Cockpit's effect model; it does not turn Star Citizen into an aerodynamic simulation. No effect is synthesized from a key press.

| Star Citizen source | DCS export | Meaning / qualification |
|---|---|---|
| Acceleration XYZ, m/s² | `acc_z`, `acc_x`, `acc_y`, G | SC right/forward/up → DCS forward/up/right; divide by 9.80665. No smoothing, clipping, gravity subtraction or added 1G |
| Angular velocity XYZ, rad/s | `euler_vz`, `euler_vx`, `euler_vy` | Same body-axis permutation; units unchanged |
| Body velocity magnitude | `tas`, `ias` | Virtual aircraft speed: raw m/s × 231.5 / 650; linear and unclipped |
| Body velocity direction | `aoa`, `aos` | Virtual angles in degrees, calculated from body velocity. Wind and atmospheric density are unavailable |
| Body velocity magnitude | `mach` | Virtual Earth-reference cue: raw speed / 340.29. Not a measured Mach number of the ship |
| VehicleFrame engine flag (4), thrust vector (38) | `engine_rpm_left/right` | Effect-equivalent RPM: powered idle 15%, increasing toward 100% with thrust magnitude. SC does not export turbine RPM |
| Vibration boost (41) | `afterburner_1/2` | Normalized event channel; zero in the recorded flight, needs live verification |
| Vibration atmosphere (43) | Engine rumble equivalent | Raises RPM cue; no invented wind vector |
| VehicleFrame gear (92) | `gear_value`, `left/nose/right_gear` | All legs follow the same normalized gear channel |
| Weapon event (5) | `cannon_shells` decreases | One decrement per distinct event; virtual counter, not real ammunition. Triggers Cockpit gun-fire effect |
| ExplosiveOrdnance event (6) | `weapon` payload count decreases | Virtual generic ordnance descriptor; not a verified missile/bomb identification |
| Impact/Explosion event (7/8) | 180 ms engine-rumble cue | Effect equivalent only; not hull health. Physical impact acceleration is already forwarded independently |
| Gear/engine state | Gear/APU lights | Simple state equivalents |
| Unavailable values | Neutral export values | World velocity, altitude, absolute attitude, trim, flaps, canopy, spoiler, speedbrake, countermeasures, rotor |

The 650 m/s point is a configurable feel reference, **not a hard maximum Star Citizen speed**. At 1300 m/s the output is 463 m/s. There is no Elite-style FSD/supercruise mode conversion. SimHub always retains the original speed and accelerations.

The recorded Weapon event contains subtype values 0/1/2 whose exact correspondence has not been verified. They all drive the gun-fire cue rather than inventing ammunition or missile classifications. The frequent Recoil event (13) is not mixed into acceleration: its vector semantics are not yet verified, and doing so could double-count a force. Other unsupported events remain observable internally but do not fabricate DCS controls.

## Combat 3 — third preset, 2026-11-07

Import **StarCitizen-AB9-Combat-3.preset** and select **Load Now**. The profile is named **Star Citizen — AB9 Combat 3**, with its own UUID. It is based on v0.3 Soft; both previous presets remain available. The application stays at 0.2.0.

The user reported that pulling the nose up sharply during combat made the stick pull farther toward the pilot, interfering with aiming. This revision disables the following candidate force effects as a group; no individual effect has been isolated as the confirmed cause in a live test.

| Effect | v0.3 Soft | Combat 3 | Preset field |
|---|---|---|---|
| G Force | On | Off | `new_gforce_effect_enable` |
| Deceleration | On | Off | `deceleration_effect_enable`, `deceleration_max_force_switch` |
| AoA reverse force | On | Off | `aoa_reduction_max_force_switch` |
| Elevator Weight | On | Off | `elevator_droop_switch` |

The five enable fields are false. Stored strengths, thresholds and curves are retained but the corresponding effects are disabled. Q-feel stick pressure, aerodynamic damping, Dynamic Pressure and the base spring/damping/friction settings are unchanged. Stick Shaker remains at 6; weapons, engine, gear, stall/transonic buffet and other vibration settings are unchanged. Axis curves, telemetry conversion and the SimHub output are unchanged.

The JSON diff was checked against v0.3 Soft: exactly five enable fields plus name, UUID and timestamp changed. Local computer tools could not initialize during this revision, so import, activation and physical feel of Combat 3 are not yet verified. Importing the file is still required; publishing it does not activate it in Cockpit.

## Preset v0.3 Soft — 2026-11-07

This is a new preset UUID, derived from v0.2 after the user reported working live feedback but an uncomfortable Stick Shaker and excessive directional forces. The bridge version and telemetry conversion are unchanged. Import **StarCitizen-AB9-v0.3-Soft.preset**, then choose **Load Now**. The v0.2 preset remains available.

| Setting | v0.2 | v0.3 Soft |
|---|---:|---:|
| Stick Shaker intensity | 24 | 6 |
| G Force intensity | 30 | 21 |
| Deceleration maximum force | 25 | 18 |
| Aileron stick pressure | 32 | 22 |
| Elevator stick pressure | 29 | 20 |
| Dynamic Pressure effect intensity | 24 | 17 |
| AoA maximum reverse force | 22 | 15 |
| Elevator Weight effect intensity | 14 | 10 |

Stick Shaker retains 25% of its previous intensity. Directional effect strength controls retain approximately 70%, rounded to integer settings. Frequency, activation thresholds, response curves and relative gain controls are retained. This is a reduction of the preset controls, not a measurement of the final torque after effects are combined. Overall force, basic spring/damping/friction, weapons, engine, gear and other vibration effects are unchanged.

The JSON was checked to change exactly these eight telemetry settings plus its name, UUID and timestamp. Local PC tooling was unavailable when it was prepared. The user subsequently confirmed importing Soft and flying with it; the remaining fore/aft pull during combat led to the separate Combat 3 preset above.

## Original v0.2 preset

The preset is a separate UUID based on RacerCHA's `Elite-AB9-v4.preset`. It preserves base settings, axes and existing feel curves: overall force 100%, maximum torque 100%, centering spring 22%. All 27 jet effect pages are enabled, including weapon, engine, gear, G-force and speed effects. Mechanisms without source data remain neutral. Rotor/propeller settings inherited from the preset are not used by this jet output, and no autopilot commands are sent.

Changes include G-force strength 30% with existing thresholds +1…+10G / −6…−1G, deceleration maximum force 25%, aerodynamic damping, dynamic pressure and the previously disabled jet effects. These are Cockpit effect settings, not filters on transmitted telemetry. A complete frame contains all implemented effects simultaneously. The exact combined feel must be judged in live flight.

Because Elite and Star Citizen both identify as A-10C II, automatic aircraft-based selection cannot distinguish them. Keep auto-switch off and explicitly load the relevant preset. Loading Star Citizen does not overwrite Elite.

## Validation boundary

Isolated tests cover all exported keys, axes/units, unclipped peaks/speed, distinct weapon events, invalid input, pilot gating, TCP disconnect/reconnect, stale-source expiration and independent SimHub/MOZA toggles. Test TCP executables use a different name so Cockpit cannot mistake them for live DCS. Synthetic or recorded crash data is never sent to the real device by these tests.

The historic flight recording contains 18,390 vehicle frames and 81 Weapon events. Gear and boost were zero throughout; ordnance and explicit Impact/Explosion events were absent. Supporting those channels in code is not a claim that they have been observed live. The v0.2 preset was imported and checked in Cockpit 1.1.5.42. The user subsequently confirmed working live feedback and requested softer effects; this does not individually validate every mapped event.

## Configuration

`MozaCockpitPath`, `MozaTcpPort`, `MozaUdpPort`, `MozaShipSpeedScale` and `MozaDcsSpeedScale` are optional settings. Existing v0.1.0 settings files continue to work with the defaults shown in `settings.example.json`. Restart the app after changing ports/scales. `runtime/moza-status.json` shows TCP connections, counts and errors; `runtime/status.json` contains the bridge's MOZA source diagnostics.
