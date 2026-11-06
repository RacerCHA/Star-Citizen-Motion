# Third-party notices

The D-BOX protobuf schema and event semantics are based on [DMUSER15/SC-Motion-Haptic-Bridge](https://github.com/DMUSER15/SC-Motion-Haptic-Bridge), pinned to commit `53a4fba0bab91db841264948366f06150be06729`. The upstream project uses GPL-3.0. Its schema source is retained in `upstream/motion_schema.py`; `receiver/motion-schema.json` records the same provenance.

The Node.js receiver, UDP conversion, setup tools and tray application are distributed under GPL-3.0-or-later. The full license is in `LICENSE`.

`SimHub-generated-contract.cs` is the interoperability contract generated from `StarCitizen.simdef` by the SimHub 9.13.3 definition editor. The runtime bridge uses that packet layout; SimHub itself is a separate dependency.

No D-BOX DLLs, installers, Star Citizen files, Node.js binaries, private certificates or account credentials are distributed here. Users obtain the dependencies from their vendors. CIG, Star Citizen, D-BOX, SimHub and MOZA names identify compatibility targets and do not imply endorsement.

The Star Citizen AB9 preset is derived from `presets/Elite-AB9-v4.preset` in [RacerCHA/Moza-Fly-Telemetry-Bridge](https://github.com/RacerCHA/Moza-Fly-Telemetry-Bridge). DCS wire compatibility was checked against the installed MOZA exporter and that project's public source. The original preset carries the MIT license:

MIT License

Copyright (c) 2026 RacerCHA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
