# Changelog

## 0.0.3 (2026-10-24)

### New
- Filter by several tags: click tags in the inspector to show rows that have all of them
- Tags that never appear with the selected ones fade out while filtering
- Hide done: a switch beside the Tags heading leaves done and canceled rows out of filters, counts, the map and suggestions
- This row card: the selected rows' tags, with one-click adds for your most-used tags
- Open and done bars and counts for every tag
- Map view: tags against your four busiest top-level rows, the rest combined in one column; click a cell to see a tag in one area
- Convert window: review rows with inline #tags and pick which to convert
- A yellow notice at the top of the inspector while inline #tags remain

### Changed
- The Tags section collapses, like the other inspector sections, and remembers its state
- Tagging happens in the This row card and filtering in the tag list, each under its own heading
- Clear filter sits in the filter's heading
- Inspector panels use a shared card style, a soft tint of the text color that reads in light and dark
- The + beside the Tags heading gives way to the Hide done switch; the This row card and ⌘⇧T add tags

### Fixed
- Clear and other links in the inspector use the accent color
- Converting inline #tags no longer crashes Bike
- The notice and the Convert window count the same rows
- The inspector updates when Hide done changes a filter whose tags stay the same

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
