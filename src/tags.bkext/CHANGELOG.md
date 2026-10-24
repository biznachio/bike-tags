# Changelog

## 0.0.2 (2026-10-24)

- Tags draw as badges: a tag symbol and the name in a rounded box with a soft slate fill and a matching stroke. The box uses Bike's own badge corners, so it lines up with the highlight Bike draws while filtering.
- Colors come from the active theme, so light and dark mode both look right. Themes can set `tag-fill`, `tag-stroke`, `tag-text` and `tag-icon` to restyle tags.
- The filtered tag becomes solid accent with white text. Every tag uses regular weight.
- Tags on done and canceled rows fade halfway toward the background, staying opaque so nothing behind them shows through.
- The inspector list and menus use the tag symbol and slate counts to match.

## 0.0.1 (2026-10-24)

First version.

- `tag` row attribute holding a comma list of tags, kept lowercase and deduped.
- Tag pills after the row text, with a "+N" overflow pill and a menu on click.
- Add Tag picker (⌘⇧T) with suggestions, new tags and several tags at once.
- Tags list in the inspector with counts, click-to-filter and rename.
- Show Tag, Clear Tag Filter, Remove Tag and Rename Tag commands.
- Convert Hash Tags: moves inline #tags into the attribute, with a preview.
