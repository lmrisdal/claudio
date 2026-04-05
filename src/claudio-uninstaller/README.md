# claudio-uninstaller

Portable games have no uninstaller of their own — they're just a folder of
files. This is a standalone Windows uninstaller
(`claudio-game-uninstaller.exe`) that Claudio drops into each portable game's
install directory and registers under `HKCU\...\Uninstall\<key>`, so the game
shows up in "Apps & Features" and can be removed the normal way.

## How it works

Reads `uninstall-config.json` next to the exe, confirms with the user, then
removes the registry entry, the Start Menu / Desktop shortcuts, and the
install directory.

## Config format

```json
{
  "gameTitle": "Example Game",
  "installPath": "C:\\...\\Games\\Example Game",
  "registryKeyName": "Claudio.ExampleGame",
  "shortcutPath": "C:\\...\\Start Menu\\Programs\\Example Game.lnk",
  "desktopShortcutPath": "C:\\...\\Desktop\\Example Game.lnk"
}
```

`shortcutPath` and `desktopShortcutPath` are optional.
