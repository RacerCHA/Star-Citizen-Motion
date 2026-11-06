# Third-party notices

The D-BOX protobuf schema and event semantics are based on [DMUSER15/SC-Motion-Haptic-Bridge](https://github.com/DMUSER15/SC-Motion-Haptic-Bridge), pinned to commit `53a4fba0bab91db841264948366f06150be06729`. The upstream project uses GPL-3.0. Its schema source is retained in `upstream/motion_schema.py`; `receiver/motion-schema.json` records the same provenance.

The Node.js receiver, UDP conversion, setup tools and tray application are distributed under GPL-3.0-or-later. The full license is in `LICENSE`.

`SimHub-generated-contract.cs` is the interoperability contract generated from `StarCitizen.simdef` by the SimHub 9.13.3 definition editor. The runtime bridge uses that packet layout; SimHub itself is a separate dependency.

No D-BOX DLLs, installers, Star Citizen files, Node.js binaries, private certificates or account credentials are distributed here. Users obtain the dependencies from their vendors. CIG, Star Citizen, D-BOX, SimHub and MOZA names identify compatibility targets and do not imply endorsement.
