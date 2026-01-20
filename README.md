# Kine's Central Copilot Instruction Sync

Synchronize centralized GitHub Copilot instructions from remote URLs based on programming language configuration. Keep your team's Copilot instructions consistent across all repositories by fetching them from a central source.

## Features

- **Automatic Language Detection**: Detects the programming language of your workspace (C#, AL, TypeScript, Python, and many more)
- **URL-Based Instructions**: Fetch Copilot instructions from any accessible URL (GitHub raw files, internal servers, etc.)
- **Multi-Language Support**: Configure different instruction sources for different programming languages
- **Automatic Sync on Open**: Optionally sync instructions when you open a workspace
- **Manual Sync Commands**: Sync instructions on-demand via command palette

## How It Works

1. When a workspace is opened, the extension detects the programming languages used
2. It checks your configured instruction sources for a matching language
3. If the remote instructions differ from local `.github/copilot-instructions.md`, they are synchronized
4. Your team's centralized Copilot instructions are now available in your workspace

## Extension Settings

This extension contributes the following settings:

### `instructionSync.sources`

An array of instruction sources. Each source has:

- `language`: The programming language (e.g., "C#", "AL", "TypeScript")
- `url`: The URL to fetch instructions from
- `enabled`: Whether this source is active (default: true)
- `destinationFolder`: The folder where the instructions file will be created (default: ".github")
- `destinationFile`: The name of the instructions file (default: "copilot-instructions.md")

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
