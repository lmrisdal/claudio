#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-x86_64-pc-windows-msvc}"
RUSTUP_HOME_DIR="${RUSTUP_HOME:-$(rustup show home)}"
TOOLCHAIN="${RUSTUP_TOOLCHAIN:-$(rustup show active-toolchain | awk '{print $1}')}"
UNINSTALLER_DIR="$ROOT_DIR/src/claudio-uninstaller"
UNINSTALLER_TARGET_DIR="$ROOT_DIR/target/$TARGET/release"
UNINSTALLER_BUNDLE_DIR="$ROOT_DIR/target/release"

if ! command -v llvm-lib >/dev/null 2>&1 || ! command -v clang-cl >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    LLVM_PREFIX="$(brew --prefix llvm 2>/dev/null || true)"
    if [ -n "$LLVM_PREFIX" ] && [ -d "$LLVM_PREFIX/bin" ]; then
      export PATH="$LLVM_PREFIX/bin:$PATH"
    fi
  fi
fi

if ! command -v cargo-xwin >/dev/null 2>&1; then
  if rustup run "$TOOLCHAIN" cargo xwin --version >/dev/null 2>&1; then
    :
  else
    printf 'cargo-xwin is required. Install it with: cargo install cargo-xwin\n' >&2
    exit 1
  fi
fi

if ! rustup target list --toolchain "$TOOLCHAIN" --installed | grep -qx "$TARGET"; then
  mkdir -p "$RUSTUP_HOME_DIR/downloads" "$RUSTUP_HOME_DIR/tmp" 2>/dev/null || true

  if [ ! -w "$RUSTUP_HOME_DIR" ] || [ ! -w "$RUSTUP_HOME_DIR/downloads" ] || [ ! -w "$RUSTUP_HOME_DIR/tmp" ]; then
    printf 'rustup home is not writable: %s\n' "$RUSTUP_HOME_DIR" >&2
    printf 'Fix it with: sudo chown -R "$USER":staff "%s"\n' "$RUSTUP_HOME_DIR" >&2
    exit 1
  fi

  printf 'Installing Rust target %s via rustup\n' "$TARGET"
  if ! rustup target add --toolchain "$TOOLCHAIN" "$TARGET"; then
    printf 'Failed to install Rust target %s via rustup\n' "$TARGET" >&2
    exit 1
  fi
fi

if ! command -v llvm-lib >/dev/null 2>&1 || ! command -v clang-cl >/dev/null 2>&1; then
  printf 'LLVM tools for Windows cross-compiling are missing from PATH.\n' >&2
  printf 'Install and expose them with: brew install llvm\n' >&2
  printf 'Current PATH does not provide clang-cl and llvm-lib.\n' >&2
  exit 1
fi

rustup run "$TOOLCHAIN" cargo xwin build --release --target "$TARGET" --manifest-path "$UNINSTALLER_DIR/Cargo.toml"
mkdir -p "$UNINSTALLER_BUNDLE_DIR"
cp "$UNINSTALLER_TARGET_DIR/claudio-game-uninstaller.exe" "$UNINSTALLER_BUNDLE_DIR/claudio-game-uninstaller.exe"
rustup run "$TOOLCHAIN" cargo xwin build --release --target "$TARGET" --manifest-path "$ROOT_DIR/src/claudio-desktop/Cargo.toml"
