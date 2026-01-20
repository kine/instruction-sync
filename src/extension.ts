import * as vscode from 'vscode';
import * as path from 'path';

interface InstructionSource {
	language: string;
	url: string;
	enabled?: boolean;
}

const COPILOT_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';

/**
 * Checks if a URL is a GitHub or GitHub Enterprise URL
 */
function isGitHubUrl(url: string): { isGitHub: boolean; isEnterprise: boolean } {
	try {
		const parsedUrl = new URL(url);
		const hostname = parsedUrl.hostname.toLowerCase();

		if (hostname === 'github.com' || hostname === 'raw.githubusercontent.com') {
			return { isGitHub: true, isEnterprise: false };
		}

		if (hostname.endsWith('.ghe.com') || hostname.endsWith('.github.com')) {
			return { isGitHub: true, isEnterprise: true };
		}

		return { isGitHub: false, isEnterprise: false };
	} catch {
		return { isGitHub: false, isEnterprise: false };
	}
}

/**
 * Gets GitHub authentication token if available
 */
async function getGitHubToken(isEnterprise: boolean): Promise<string | null> {
	try {
		// Use the appropriate auth provider based on whether it's enterprise or not
		const scopes = ['repo'];
		const authProviderId = isEnterprise ? 'github-enterprise' : 'github';

		const session = await vscode.authentication.getSession(authProviderId, scopes, {
			createIfNone: false,
			silent: true
		});

		if (session) {
			return session.accessToken;
		}

		// Try without silent mode if no session found
		const interactiveSession = await vscode.authentication.getSession(authProviderId, scopes, {
			createIfNone: false
		});

		return interactiveSession?.accessToken ?? null;
	} catch (error) {
		console.log('GitHub authentication not available:', error);
		return null;
	}
}

/**
 * Fetches content from a remote URL, using GitHub auth if applicable
 */
async function fetchRemoteContent(url: string): Promise<string> {
	const { isGitHub, isEnterprise } = isGitHubUrl(url);

	const headers: Record<string, string> = {
		'Accept': 'application/vnd.github.v3.raw'
	};

	if (isGitHub) {
		const token = await getGitHubToken(isEnterprise);
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		throw new Error(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
	}
	return await response.text();
}

/**
 * Gets the current content of the local copilot-instructions.md file
 */
async function getLocalInstructions(workspaceFolder: vscode.WorkspaceFolder): Promise<string | null> {
	const instructionsUri = vscode.Uri.joinPath(workspaceFolder.uri, COPILOT_INSTRUCTIONS_PATH);
	try {
		const content = await vscode.workspace.fs.readFile(instructionsUri);
		return Buffer.from(content).toString('utf8');
	} catch {
		return null;
	}
}

/**
 * Writes content to the local copilot-instructions.md file
 */
async function writeLocalInstructions(workspaceFolder: vscode.WorkspaceFolder, content: string): Promise<void> {
	const githubFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, '.github');
	const instructionsUri = vscode.Uri.joinPath(workspaceFolder.uri, COPILOT_INSTRUCTIONS_PATH);

	// Ensure .github directory exists
	try {
		await vscode.workspace.fs.createDirectory(githubFolderUri);
	} catch {
		// Directory may already exist
	}

	await vscode.workspace.fs.writeFile(instructionsUri, Buffer.from(content, 'utf8'));
}

/**
 * Detects the primary language of the workspace based on file extensions
 */
async function detectWorkspaceLanguage(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
	const detectedLanguages: string[] = [];

	const languagePatterns: { [key: string]: string[] } = {
		'AL': ['**/*.al'],
		'C#': ['**/*.cs', '**/*.csproj'],
		'TypeScript': ['**/*.ts', '**/*.tsx'],
		'JavaScript': ['**/*.js', '**/*.jsx'],
		'Python': ['**/*.py'],
		'Java': ['**/*.java'],
		'Go': ['**/*.go'],
		'Rust': ['**/*.rs'],
		'C++': ['**/*.cpp', '**/*.hpp', '**/*.cc'],
		'C': ['**/*.c', '**/*.h'],
		'Ruby': ['**/*.rb'],
		'PHP': ['**/*.php'],
		'Swift': ['**/*.swift'],
		'Kotlin': ['**/*.kt'],
	};

	for (const [language, patterns] of Object.entries(languagePatterns)) {
		for (const pattern of patterns) {
			const relativePattern = new vscode.RelativePattern(workspaceFolder, pattern);
			const files = await vscode.workspace.findFiles(relativePattern, '**/node_modules/**', 1);
			if (files.length > 0) {
				detectedLanguages.push(language);
				break;
			}
		}
	}

	return detectedLanguages;
}

/**
 * Synchronizes instructions for a specific language configuration
 */
async function syncInstructions(
	workspaceFolder: vscode.WorkspaceFolder,
	source: InstructionSource,
	showNotifications: boolean = true,
	requireConfirmation: boolean = true
): Promise<boolean> {
	try {
		const remoteContent = await fetchRemoteContent(source.url);
		const localContent = await getLocalInstructions(workspaceFolder);

		if (localContent !== remoteContent) {
			// Check if confirmation is required
			if (requireConfirmation) {
				const config = vscode.workspace.getConfiguration('instructionSync');
				const confirmBeforeSync = config.get<boolean>('confirmBeforeSync', true);

				if (confirmBeforeSync) {
					const action = localContent === null ? 'create' : 'overwrite';
					const message = `Instruction Sync: ${action === 'create' ? 'Create' : 'Overwrite'} copilot-instructions.md with ${source.language} instructions from remote?`;

					const result = await vscode.window.showWarningMessage(
						message,
						{ modal: false },
						'Yes',
						'No',
						'Always (disable confirmation)'
					);

					if (result === 'No' || result === undefined) {
						return false;
					}

					if (result === 'Always (disable confirmation)') {
						await config.update('confirmBeforeSync', false, vscode.ConfigurationTarget.Global);
					}
				}
			}

			await writeLocalInstructions(workspaceFolder, remoteContent);
			if (showNotifications) {
				vscode.window.showInformationMessage(
					`Instruction Sync: Updated copilot-instructions.md from ${source.language} configuration`
				);
			}
			return true;
		} else {
			if (showNotifications) {
				vscode.window.showInformationMessage(
					`Instruction Sync: Instructions are already up to date for ${source.language}`
				);
			}
			return false;
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(
			`Instruction Sync: Failed to sync instructions for ${source.language}: ${errorMessage}`
		);
		return false;
	}
}

/**
 * Gets the instruction sources from configuration
 */
function getInstructionSources(): InstructionSource[] {
	const config = vscode.workspace.getConfiguration('instructionSync');
	return config.get<InstructionSource[]>('sources', []);
}

/**
 * Main sync function that checks workspace languages and syncs matching instructions
 */
async function performSync(showNotifications: boolean = true): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		if (showNotifications) {
			vscode.window.showWarningMessage('Instruction Sync: No workspace folder open');
		}
		return;
	}

	const sources = getInstructionSources();
	if (sources.length === 0) {
		if (showNotifications) {
			vscode.window.showInformationMessage(
				'Instruction Sync: No instruction sources configured. Add sources in settings.'
			);
		}
		return;
	}

	for (const workspaceFolder of workspaceFolders) {
		const detectedLanguages = await detectWorkspaceLanguage(workspaceFolder);

		if (detectedLanguages.length === 0) {
			continue;
		}

		// Find matching source configurations
		for (const source of sources) {
			if (source.enabled === false) {
				continue;
			}

			// Case-insensitive language matching
			const matchingLanguage = detectedLanguages.find(
				lang => lang.toLowerCase() === source.language.toLowerCase()
			);

			if (matchingLanguage) {
				await syncInstructions(workspaceFolder, source, showNotifications);
				// Only sync the first matching source per workspace folder
				break;
			}
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Instruction Sync extension is now active');

	// Register the manual sync command
	const syncCommand = vscode.commands.registerCommand('kine-instruction-sync.sync', async () => {
		await performSync(true);
	});

	// Register the force sync command (syncs without checking language)
	const forceSyncCommand = vscode.commands.registerCommand('kine-instruction-sync.forceSync', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showWarningMessage('Instruction Sync: No workspace folder open');
			return;
		}

		const sources = getInstructionSources();
		if (sources.length === 0) {
			vscode.window.showWarningMessage('Instruction Sync: No instruction sources configured');
			return;
		}

		// Let user pick which source to sync
		const enabledSources = sources.filter(s => s.enabled !== false);
		const picked = await vscode.window.showQuickPick(
			enabledSources.map(s => ({ label: s.language, description: s.url, source: s })),
			{ placeHolder: 'Select instruction source to sync' }
		);

		if (picked) {
			for (const workspaceFolder of workspaceFolders) {
				await syncInstructions(workspaceFolder, picked.source, true);
			}
		}
	});

	// Register command to add a new source
	const addSourceCommand = vscode.commands.registerCommand('kine-instruction-sync.addSource', async () => {
		const language = await vscode.window.showInputBox({
			prompt: 'Enter the language name (e.g., C#, AL, TypeScript)',
			placeHolder: 'Language name'
		});

		if (!language) {
			return;
		}

		const url = await vscode.window.showInputBox({
			prompt: 'Enter the URL to the instructions file',
			placeHolder: 'https://example.com/copilot-instructions.md'
		});

		if (!url) {
			return;
		}

		const config = vscode.workspace.getConfiguration('instructionSync');
		const sources = config.get<InstructionSource[]>('sources', []);

		sources.push({ language, url, enabled: true });

		await config.update('sources', sources, vscode.ConfigurationTarget.Global);
		vscode.window.showInformationMessage(`Instruction Sync: Added source for ${language}`);
	});

	// Perform sync on activation (when workspace opens)
	const config = vscode.workspace.getConfiguration('instructionSync');
	const syncOnOpen = config.get<boolean>('syncOnOpen', true);

	if (syncOnOpen) {
		// Delay slightly to ensure workspace is fully loaded
		setTimeout(() => performSync(false), 1000);
	}

	// Watch for configuration changes
	const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('instructionSync')) {
			const newConfig = vscode.workspace.getConfiguration('instructionSync');
			const syncOnChange = newConfig.get<boolean>('syncOnConfigChange', false);
			if (syncOnChange) {
				performSync(false);
			}
		}
	});

	context.subscriptions.push(syncCommand, forceSyncCommand, addSourceCommand, configWatcher);
}

export function deactivate() { }
