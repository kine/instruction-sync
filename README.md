# Kine's Central Copilot Instruction Sync

Synchronize centralized GitHub Copilot instructions from remote URLs or local files based on programming language configuration. Keep your team's Copilot instructions consistent across all repositories by fetching them from a central source.

## Features

- **Automatic Language Detection**: Detects the programming language of your workspace (C#, AL, TypeScript, Python, and many more)
- **URL-Based Instructions**: Fetch Copilot instructions from any accessible URL (GitHub raw files, internal servers, etc.)
- **Local File Support**: Use local file paths as instruction sources (useful for shared network drives or local development)
- **Multi-Language Support**: Configure different instruction sources for different programming languages
- **Multiple Files per Language**: Sync multiple instruction files for a single language to different destinations
- **Automatic Sync on Open**: Optionally sync instructions when you open a workspace
- **Manual Sync Commands**: Sync instructions on-demand via command palette
- **Flexible Confirmation**: Confirm individually, "Yes to All" for the current session, or disable permanently

## How It Works

1. When a workspace is opened, the extension detects the programming languages used
2. It checks your configured instruction sources for a matching language
3. All matching sources are synced — you can define multiple files per language with different destinations
4. If the remote instructions differ from the local file, they are synchronized
5. Your team's centralized Copilot instructions are now available in your workspace

## Extension Settings

This extension contributes the following settings:

### `instructionSync.sources`

An array of instruction sources. Each source has:

- `language`: The programming language (e.g., "C#", "AL", "TypeScript")
- `url`: The URL or local file path to fetch instructions from
- `enabled`: Whether this source is active (default: true)
- `destinationFolder`: The folder where the instructions file will be created (default: ".github")
- `destinationFile`: The name of the instructions file (default: "copilot-instructions.md")

**Supported source formats:**

- Remote URLs: `https://example.com/instructions.md`
- Local Windows paths: `C:\shared\instructions.md`
- Local Unix paths: `/shared/instructions.md`
- File URIs: `file:///C:/shared/instructions.md`

Example configuration:

```json
{
  "instructionSync.sources": [
    {
      "language": "C#",
      "url": "https://raw.githubusercontent.com/your-org/standards/main/copilot-instructions-csharp.md",
      "enabled": true
    },
    {
      "language": "AL",
      "url": "https://raw.githubusercontent.com/your-org/standards/main/copilot-instructions-al.md",
      "enabled": true,
      "destinationFolder": ".vscode",
      "destinationFile": "al-instructions.md"
    },
    {
      "language": "TypeScript",
      "url": "https://raw.githubusercontent.com/your-org/standards/main/copilot-instructions-typescript.md",
      "enabled": true
    }
  ]
}
```

#### Multiple files per language

You can define multiple sources for the same language, each with a different destination file:

```json
{
  "instructionSync.sources": [
    {
      "language": "C#",
      "url": "https://example.com/csharp-general.md",
      "destinationFile": "copilot-instructions.md"
    },
    {
      "language": "C#",
      "url": "https://example.com/csharp-testing.md",
      "destinationFile": "copilot-testing-instructions.md"
    },
    {
      "language": "C#",
      "url": "https://example.com/csharp-architecture.md",
      "destinationFolder": ".vscode",
      "destinationFile": "copilot-architecture.md"
    }
  ]
}
```

Each source is uniquely identified by the combination of `language` + destination path. When merging remote and local configurations, a local source overrides a remote source only if both the language and destination path match.

### `instructionSync.syncOnOpen`

- Type: `boolean`
- Default: `true`
- Automatically sync instructions when a workspace is opened

### `instructionSync.syncOnConfigChange`

- Type: `boolean`
- Default: `false`
- Automatically sync instructions when the configuration changes

### `instructionSync.confirmBeforeSync`

- Type: `boolean`
- Default: `true`
- Show confirmation dialog before overwriting local instructions
- When multiple files are being synced, the confirmation dialog offers **"Yes to All"** to approve all remaining files in the current sync session

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Instruction Sync: Sync Copilot Instructions` | Sync instructions based on detected workspace language |
| `Instruction Sync: Force Sync Copilot Instructions (Select Source)` | Choose a specific source to sync from |
| `Instruction Sync: Add Instruction Source` | Add a new language/URL source via guided input |

## Supported Languages

The extension can detect the following languages:

- AL
- C#
- TypeScript
- JavaScript
- Python
- Java
- Go
- Rust
- C++
- C
- Ruby
- PHP
- Swift
- Kotlin
- Powershell

## Usage Example

1. Install the extension
2. Open Settings (`Ctrl+,`) and search for "Instruction Sync"
3. Add your instruction sources with language and URL mappings
4. Open a workspace - instructions will be automatically synced if the language matches
5. Or manually run "Sync Copilot Instructions" from the Command Palette

## Requirements

- VS Code 1.108.1 or higher
- Network access to the configured instruction URLs

## Release Notes

### 0.0.10

- Support multiple instruction sources per language with different destination files
- Added "Yes to All" option in confirmation dialog for batch sync sessions

### 0.0.6

- Extended AL language detection to also detect `app.json` in root folder

### 0.0.5

- Improved multi-root workspace support with folder names in messages

### 0.0.4

- Added support for local file paths as instruction sources
- Supports Windows paths, Unix paths, and file:// URIs

### 0.0.3

- Per-language destination folder and file settings
- Confirmation dialog setting
- Improved user messages to show actual file names

### 0.0.2

- Added extension icon for marketplace

### 0.0.1

Initial release:

- Language detection for workspaces
- Configurable instruction sources (language + URL)
- Automatic sync on workspace open
- Manual sync commands
- Support for multiple languages

---

**Enjoy consistent Copilot instructions across your team!**
