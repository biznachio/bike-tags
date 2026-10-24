# Tags for Bike

Tags for [Bike 2](https://www.hogbaysoftware.com/bike/) that live in a row attribute instead of the row text. A row can carry several tags, each one shows as a badge after the text, and one click shows every row with that tag.

```
tag: assignment, reading, history
```

**[Download the latest release](https://github.com/biznachio/bike-tags/releases/latest)**

## What it does

- **Multiple tags per row.** A row can carry as many tags as you like, stored together in one `tag` attribute as a comma list, and each shows as its own badge.
- **Tag badges.** Each tag on a row shows as a badge with a tag symbol. Rows with more than three tags show three plus a "+2" badge. Done and canceled rows fade theirs.
- **Click a tag** to show rows with that tag, remove it from the row, rename it everywhere, or add another tag.
- **Add Tag (⌘⇧T).** Type to pick from tags you already use, or type a new one. Separate tags with commas to add several at once. Works on several selected rows too.
- **Tags in the inspector.** Every tag with its row count. Click a tag to show its rows; click it again to clear. Hover a tag to rename it.
- **Filtering.** The tag you're filtering on turns blue, in the outline and in the inspector.
- **Rename everywhere.** Renaming to a tag you already use merges the two.
- **Convert inline #tags.** If you've been writing `#tags` in your row text, one command lifts them into the tag attribute. It shows a preview first, and you can undo it.

## Install

1. Download `tags.bkext.zip` from the [latest release](https://github.com/biznachio/bike-tags/releases/latest) and unzip it.
2. Quit Bike.
3. Copy `tags.bkext` into Bike's Extensions folder. Settings › Extensions can reveal it.
4. Reopen Bike.

Requires Bike 2 with extension API 0.76 or later.

To try it before using your own outline, open [`sample/Tags Sample.bike`](sample/) in Bike. It has tagged rows to click and a few inline #tags to convert.

## Commands

| Command | Shortcut |
| --- | --- |
| Add Tag | ⌘⇧T |
| Remove Tag | |
| Show Tag | |
| Clear Tag Filter | |
| Rename Tag | |
| Convert Hash Tags | |

## How tags are stored

All of a row's tags sit in one `tag` attribute as a comma list. The extension keeps that list tidy: lowercase, no duplicates, separated by ", ". If you edit the attribute by hand in Bike's Attributes Editor, it settles into that form in the same undo step, and suggestions complete the tag you're typing.

Because the value is one string, Bike's plain `@tag = reading` query only finds rows whose only tag is `reading`. The extension's filter handles lists for you. For a saved search of your own, use the same shape:

```
//@tag = "reading" or @tag beginswith "reading," or @tag endswith ", reading" or @tag contains ", reading,"
```

## Theme colors

Tag colors come from the active theme, mixed from its background and text, so they suit light and dark themes without setup. To restyle tags, a theme can define any of these colors:

| Color | Used for |
| --- | --- |
| `tag-fill` | Badge background |
| `tag-stroke` | Badge border |
| `tag-text` | Tag name |
| `tag-icon` | Tag symbol |

The tag you're filtering on always uses the theme's accent color.

## Limits

- Bike's sidebar only holds entries that point to a row, so the tag list lives in the inspector.
- Bike doesn't tell extensions when a filter changes, so the extension checks a few times a second to keep the blue highlight in step.

## Build from source

```sh
npm install
npx bike-ext build --install   # build and install into Bike
npx bike-ext test tags         # run the tests inside Bike
```

The built extension lands in `out/extensions/tags.bkext`. See the [Bike extension kit](https://github.com/bike-outliner/extension-kit) for details.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## Credits

Built with Claude. I designed and tested it.

## License

[MIT](LICENSE)
