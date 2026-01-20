# Change Log

All notable changes to the "instruction-sync" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.3] - 2026-01-20

### Added

- Per-language `destinationFolder` setting - customize where instructions are saved for each language
- Per-language `destinationFile` setting - customize the instructions filename for each language
- `instructionSync.confirmBeforeSync` setting - control confirmation dialogs

### Changed

- Destination folder and file are now configured per-language source instead of globally
- User messages now display the actual configured filename instead of hardcoded path

## [0.0.2] - 2026-01-20

### Added

- Extension icon for marketplace

## [0.0.1] - 2026-01-20

### Added

- Initial release
- Language detection for workspaces
- Configurable instruction sources (language + URL)
- Automatic sync on workspace open
- Manual sync commands
- Support for multiple languages
