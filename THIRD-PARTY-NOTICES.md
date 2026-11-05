# Third-party notices

## 7-Zip

Claudio uses parts of 7-Zip to extract `.7z` archives. 7-Zip is licensed under the GNU LGPL, with some files under the BSD 3-clause licence and the unRAR restriction. See `7-zip/License.txt` next to the Claudio sidecar for the full text of the licence that applies to the bundled version (26.05).

- Website and source code: https://www.7-zip.org
- Claudio runs the unmodified official `7zzs` (Linux) or `7za.exe` (Windows) as a separate process and does not link it into any Claudio binary.
- The matching source archive (`7z2605-src.tar.xz`) is attached to each GitHub Release that bundles 7-Zip.

The GNU Lesser General Public License, version 2.1, is available at https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html.

## umu-launcher

On Linux, Claudio downloads the official `umu-launcher` zipapp (version 1.4.4) from its GitHub release on first use and runs it as a separate process to launch games through Proton. It is not included in the Claudio installer or linked into any Claudio binary. umu-launcher is licensed under the GNU GPL, version 3.

- Website and source code: https://github.com/Open-Wine-Components/umu-launcher
- The GNU General Public License, version 3, is available at https://www.gnu.org/licenses/gpl-3.0.html.

## Electron and Chromium

The Claudio desktop app is built on Electron, which is licensed under the MIT licence, and bundles Chromium and its third-party components under their own licences, several of which require attribution.

- Electron: https://www.electronjs.org
- The full text of these licences ships with every desktop build as `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the Claudio executable.
