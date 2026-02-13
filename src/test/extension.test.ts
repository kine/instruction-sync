import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	getDestinationPath,
	isGitHubUrl,
	isAzureDevOpsUrl,
	isLocalPath,
	isValidInstructionContent,
} from '../extension';
import type { InstructionSource, SyncSession } from '../extension';

suite('getDestinationPath', () => {
	test('returns defaults when no source provided', () => {
		const result = getDestinationPath();
		assert.strictEqual(result.folder, '.github');
		assert.strictEqual(result.file, 'copilot-instructions.md');
		assert.strictEqual(result.fullPath, '.github/copilot-instructions.md');
	});

	test('returns defaults when source has no destination overrides', () => {
		const source: InstructionSource = { language: 'C#', url: 'https://example.com/file.md' };
		const result = getDestinationPath(source);
		assert.strictEqual(result.folder, '.github');
		assert.strictEqual(result.file, 'copilot-instructions.md');
		assert.strictEqual(result.fullPath, '.github/copilot-instructions.md');
	});

	test('respects custom destinationFolder', () => {
		const source: InstructionSource = { language: 'AL', url: 'https://example.com/file.md', destinationFolder: '.vscode' };
		const result = getDestinationPath(source);
		assert.strictEqual(result.folder, '.vscode');
		assert.strictEqual(result.file, 'copilot-instructions.md');
		assert.strictEqual(result.fullPath, '.vscode/copilot-instructions.md');
	});

	test('respects custom destinationFile', () => {
		const source: InstructionSource = { language: 'AL', url: 'https://example.com/file.md', destinationFile: 'al-instructions.md' };
		const result = getDestinationPath(source);
		assert.strictEqual(result.folder, '.github');
		assert.strictEqual(result.file, 'al-instructions.md');
		assert.strictEqual(result.fullPath, '.github/al-instructions.md');
	});

	test('respects both custom destinationFolder and destinationFile', () => {
		const source: InstructionSource = {
			language: 'AL',
			url: 'https://example.com/file.md',
			destinationFolder: '.vscode',
			destinationFile: 'custom.md'
		};
		const result = getDestinationPath(source);
		assert.strictEqual(result.folder, '.vscode');
		assert.strictEqual(result.file, 'custom.md');
		assert.strictEqual(result.fullPath, '.vscode/custom.md');
	});
});

suite('isGitHubUrl', () => {
	test('detects github.com', () => {
		const result = isGitHubUrl('https://github.com/org/repo');
		assert.strictEqual(result.isGitHub, true);
		assert.strictEqual(result.isEnterprise, false);
	});

	test('detects raw.githubusercontent.com', () => {
		const result = isGitHubUrl('https://raw.githubusercontent.com/org/repo/main/file.md');
		assert.strictEqual(result.isGitHub, true);
		assert.strictEqual(result.isEnterprise, false);
	});

	test('detects GitHub Enterprise (.ghe.com)', () => {
		const result = isGitHubUrl('https://mycompany.ghe.com/org/repo');
		assert.strictEqual(result.isGitHub, true);
		assert.strictEqual(result.isEnterprise, true);
	});

	test('detects GitHub Enterprise (.github.com)', () => {
		const result = isGitHubUrl('https://mycompany.github.com/org/repo');
		assert.strictEqual(result.isGitHub, true);
		assert.strictEqual(result.isEnterprise, true);
	});

	test('returns false for non-GitHub URLs', () => {
		const result = isGitHubUrl('https://example.com/file.md');
		assert.strictEqual(result.isGitHub, false);
		assert.strictEqual(result.isEnterprise, false);
	});

	test('returns false for invalid URLs', () => {
		const result = isGitHubUrl('not a url');
		assert.strictEqual(result.isGitHub, false);
		assert.strictEqual(result.isEnterprise, false);
	});
});

suite('isAzureDevOpsUrl', () => {
	test('detects dev.azure.com', () => {
		assert.strictEqual(isAzureDevOpsUrl('https://dev.azure.com/org/project/_git/repo'), true);
	});

	test('detects visualstudio.com', () => {
		assert.strictEqual(isAzureDevOpsUrl('https://myorg.visualstudio.com/project/_git/repo'), true);
	});

	test('detects URLs with /_apis/ path', () => {
		assert.strictEqual(isAzureDevOpsUrl('https://myserver.com/_apis/git/repositories'), true);
	});

	test('detects URLs with /_git/ path', () => {
		assert.strictEqual(isAzureDevOpsUrl('https://myserver.com/project/_git/repo'), true);
	});

	test('returns false for non-Azure DevOps URLs', () => {
		assert.strictEqual(isAzureDevOpsUrl('https://example.com/file.md'), false);
	});

	test('returns false for invalid URLs', () => {
		assert.strictEqual(isAzureDevOpsUrl('not a url'), false);
	});
});

suite('isLocalPath', () => {
	test('detects file:// URI', () => {
		assert.strictEqual(isLocalPath('file:///C:/folder/file.md'), true);
	});

	test('detects Windows absolute path with backslash', () => {
		assert.strictEqual(isLocalPath('C:\\folder\\file.md'), true);
	});

	test('detects Windows absolute path with forward slash', () => {
		assert.strictEqual(isLocalPath('C:/folder/file.md'), true);
	});

	test('detects Unix absolute path', () => {
		assert.strictEqual(isLocalPath('/home/user/file.md'), true);
	});

	test('returns false for HTTP URLs', () => {
		assert.strictEqual(isLocalPath('https://example.com/file.md'), false);
	});

	test('returns false for relative paths', () => {
		assert.strictEqual(isLocalPath('relative/path/file.md'), false);
	});

	test('returns false for UNC paths (double slash)', () => {
		assert.strictEqual(isLocalPath('//server/share'), false);
	});
});

suite('isValidInstructionContent', () => {
	test('accepts valid markdown content', () => {
		const result = isValidInstructionContent('# Instructions\n\nSome content here.', 'https://example.com');
		assert.strictEqual(result.valid, true);
	});

	test('rejects empty content', () => {
		const result = isValidInstructionContent('', 'https://example.com');
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes('Empty'));
	});

	test('rejects whitespace-only content', () => {
		const result = isValidInstructionContent('   \n\t  ', 'https://example.com');
		assert.strictEqual(result.valid, false);
	});

	test('rejects HTML error pages', () => {
		const html = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body></body></html>';
		const result = isValidInstructionContent(html, 'https://example.com');
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes('HTML'));
	});

	test('rejects HTML content without explicit error indicators', () => {
		const html = '<html><head><title>Some Page</title></head><body>Content</body></html>';
		const result = isValidInstructionContent(html, 'https://example.com');
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes('HTML'));
	});

	test('rejects GitHub API error JSON', () => {
		const json = '{"message": "Not Found", "documentation_url": "https://docs.github.com"}';
		const result = isValidInstructionContent(json, 'https://example.com');
		assert.strictEqual(result.valid, false);
		assert.ok(result.reason?.includes('API error'));
	});

	test('accepts content starting with { that is not an error', () => {
		const json = '{"key": "value", "data": [1, 2, 3]}';
		const result = isValidInstructionContent(json, 'https://example.com');
		assert.strictEqual(result.valid, true);
	});

	test('accepts content starting with { that is invalid JSON', () => {
		const content = '{this is not json but starts with brace}';
		const result = isValidInstructionContent(content, 'https://example.com');
		assert.strictEqual(result.valid, true);
	});
});

suite('Multiple sources per language', () => {
	test('InstructionSource supports multiple entries with same language', () => {
		const sources: InstructionSource[] = [
			{ language: 'C#', url: 'https://example.com/general.md', destinationFile: 'copilot-instructions.md' },
			{ language: 'C#', url: 'https://example.com/testing.md', destinationFile: 'copilot-testing.md' },
			{ language: 'C#', url: 'https://example.com/arch.md', destinationFolder: '.vscode', destinationFile: 'architecture.md' },
		];

		assert.strictEqual(sources.length, 3);
		assert.strictEqual(sources.filter(s => s.language === 'C#').length, 3);
	});

	test('sources with same language have unique destination paths', () => {
		const sources: InstructionSource[] = [
			{ language: 'C#', url: 'https://example.com/general.md' },
			{ language: 'C#', url: 'https://example.com/testing.md', destinationFile: 'copilot-testing.md' },
			{ language: 'C#', url: 'https://example.com/arch.md', destinationFolder: '.vscode', destinationFile: 'architecture.md' },
		];

		const paths = sources.map(s => getDestinationPath(s).fullPath);
		const uniquePaths = new Set(paths);
		assert.strictEqual(uniquePaths.size, 3, 'All destination paths should be unique');
	});

	test('sources with same language and same destination are deduplicated by composite key', () => {
		const sources: InstructionSource[] = [
			{ language: 'C#', url: 'https://example.com/old.md', destinationFile: 'copilot-instructions.md' },
			{ language: 'C#', url: 'https://example.com/new.md', destinationFile: 'copilot-instructions.md' },
		];

		// Simulate the merge logic from getInstructionSources
		const merged = new Map<string, InstructionSource>();
		for (const source of sources) {
			const { fullPath } = getDestinationPath(source);
			const key = `${source.language.toLowerCase()}::${fullPath}`;
			merged.set(key, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 1, 'Same language + destination should deduplicate');
		assert.strictEqual(result[0].url, 'https://example.com/new.md', 'Later source should win');
	});

	test('sources with same language but different destinations are kept separate', () => {
		const sources: InstructionSource[] = [
			{ language: 'C#', url: 'https://example.com/general.md', destinationFile: 'copilot-instructions.md' },
			{ language: 'C#', url: 'https://example.com/testing.md', destinationFile: 'testing-instructions.md' },
		];

		const merged = new Map<string, InstructionSource>();
		for (const source of sources) {
			const { fullPath } = getDestinationPath(source);
			const key = `${source.language.toLowerCase()}::${fullPath}`;
			merged.set(key, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 2, 'Different destinations should be kept separate');
	});
});

suite('SyncSession', () => {
	test('confirmAll starts as false', () => {
		const session: SyncSession = { confirmAll: false };
		assert.strictEqual(session.confirmAll, false);
	});

	test('confirmAll can be set to true', () => {
		const session: SyncSession = { confirmAll: false };
		session.confirmAll = true;
		assert.strictEqual(session.confirmAll, true);
	});

	test('session is shared across operations (simulated)', () => {
		const session: SyncSession = { confirmAll: false };

		// Simulate first sync setting confirmAll
		session.confirmAll = true;

		// Subsequent syncs should see confirmAll = true
		assert.strictEqual(session.confirmAll, true, 'Session state should persist across sync calls');
	});
});

suite('Source merge logic (remote + local)', () => {
	test('local source overrides remote with same language and destination', () => {
		const remoteSources: InstructionSource[] = [
			{ language: 'C#', url: 'https://remote.com/csharp.md' },
		];
		const localSources: InstructionSource[] = [
			{ language: 'C#', url: 'https://local.com/csharp.md' },
		];

		const merged = new Map<string, InstructionSource>();
		for (const source of remoteSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}
		for (const source of localSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].url, 'https://local.com/csharp.md');
	});

	test('local source does NOT override remote with same language but different destination', () => {
		const remoteSources: InstructionSource[] = [
			{ language: 'C#', url: 'https://remote.com/csharp.md', destinationFile: 'remote-instructions.md' },
		];
		const localSources: InstructionSource[] = [
			{ language: 'C#', url: 'https://local.com/csharp.md', destinationFile: 'local-instructions.md' },
		];

		const merged = new Map<string, InstructionSource>();
		for (const source of remoteSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}
		for (const source of localSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 2, 'Both sources should be preserved');
	});

	test('merge is case-insensitive for language', () => {
		const remoteSources: InstructionSource[] = [
			{ language: 'TypeScript', url: 'https://remote.com/ts.md' },
		];
		const localSources: InstructionSource[] = [
			{ language: 'typescript', url: 'https://local.com/ts.md' },
		];

		const merged = new Map<string, InstructionSource>();
		for (const source of remoteSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}
		for (const source of localSources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 1, 'Case-insensitive language should deduplicate');
		assert.strictEqual(result[0].url, 'https://local.com/ts.md');
	});

	test('multiple languages with multiple files each are all preserved', () => {
		const sources: InstructionSource[] = [
			{ language: 'C#', url: 'https://example.com/cs1.md', destinationFile: 'cs-general.md' },
			{ language: 'C#', url: 'https://example.com/cs2.md', destinationFile: 'cs-testing.md' },
			{ language: 'AL', url: 'https://example.com/al1.md', destinationFile: 'al-general.md' },
			{ language: 'AL', url: 'https://example.com/al2.md', destinationFile: 'al-perf.md' },
		];

		const merged = new Map<string, InstructionSource>();
		for (const source of sources) {
			const { fullPath } = getDestinationPath(source);
			merged.set(`${source.language.toLowerCase()}::${fullPath}`, source);
		}

		const result = Array.from(merged.values());
		assert.strictEqual(result.length, 4, 'All unique language+destination combos should be preserved');
	});
});
