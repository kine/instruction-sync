import * as vscode from 'vscode';
import * as path from 'path';

interface InstructionSource {
	language: string;
	url: string;
	enabled?: boolean;
	destinationFolder?: string;
	destinationFile?: string;
}

/**
 * Configuration for syncing VS Code settings from remote config
 */
interface SettingsConfig {
	/** Optional language filter - if set, settings only apply when this language is detected */
	language?: string;
	/** Target scope: 'user' for global settings, 'workspace' for workspace-specific */
	scope: 'user' | 'workspace';
	/** Key-value pairs of VS Code settings to apply */
	settings: Record<string, unknown>;
}

/**
 * Represents a single setting change to be applied
 */
interface SettingChange {
	key: string;
	oldValue: unknown;
	newValue: unknown;
	scope: 'user' | 'workspace';
}

interface RemoteConfig {
	sources?: InstructionSource[];
	settings?: SettingsConfig[];
	syncOnOpen?: boolean;
	syncOnConfigChange?: boolean;
	confirmBeforeSync?: boolean;
}

/** In-memory cache for remote configuration */
let remoteConfigCache: { config: RemoteConfig; timestamp: number } | null = null;

/** Tracks per-sync-session state (e.g. "Yes to All") */
interface SyncSession {
	confirmAll: boolean;
}

/**
 * Global sync lock to prevent concurrent performSync calls from
 * showing interleaved confirmation dialogs. If a sync is already
 * running, subsequent calls wait for it to finish.
 */
let activeSyncPromise: Promise<void> | null = null;

/**
 * Gets the destination path for the instructions file from source configuration
 */
function getDestinationPath(source?: InstructionSource): { folder: string; file: string; fullPath: string } {
	const folder = source?.destinationFolder ?? '.github';
	const file = source?.destinationFile ?? 'copilot-instructions.md';
	return {
		folder,
		file,
		fullPath: `${folder}/${file}`
	};
}

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
 * Checks if a URL is an Azure DevOps URL
 */
function isAzureDevOpsUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		const hostname = parsedUrl.hostname.toLowerCase();

		// Azure DevOps Services
		if (hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) {
			return true;
		}

		// Azure DevOps Server (on-premises) - check for common patterns
		if (parsedUrl.pathname.includes('/_apis/') || parsedUrl.pathname.includes('/_git/')) {
			return true;
		}

		return false;
	} catch {
		return false;
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
 * Gets Azure DevOps authentication token using Microsoft Entra ID
 * Uses the ADO resource scope with .default to get delegated permissions
 */
async function getAzureDevOpsToken(): Promise<string | null> {
	// Azure DevOps resource App ID = 499b84ac-1321-427f-aa17-267ca6975798
	// Using .default scope to get all granted delegated permissions
	const ADO_RESOURCE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

	try {
		// First try silent authentication
		const silentSession = await vscode.authentication.getSession(
			'microsoft',
			[ADO_RESOURCE_SCOPE],
			{
				createIfNone: false,
				silent: true
			}
		);

		if (silentSession?.accessToken) {
			console.log('Azure DevOps auth succeeded (silent)');
			return silentSession.accessToken;
		}

		// If no silent session, trigger interactive sign-in
		const session = await vscode.authentication.getSession(
			'microsoft',
			[ADO_RESOURCE_SCOPE],
			{
				createIfNone: true,  // triggers sign-in if needed
				clearSessionPreference: false
			}
		);

		if (session?.accessToken) {
			console.log('Azure DevOps auth succeeded (interactive)');
			return session.accessToken;
		}

		return null;
	} catch (error) {
		console.log('Azure DevOps authentication failed:', error);
		return null;
	}
}

/**
 * Checks if the source is a local file path
 */
function isLocalPath(source: string): boolean {
	// Check for file:// URI scheme
	if (source.startsWith('file://')) {
		return true;
	}
	// Check for Windows absolute path (e.g., C:\path or C:/path)
	if (/^[a-zA-Z]:[\\/]/.test(source)) {
		return true;
	}
	// Check for Unix absolute path
	if (source.startsWith('/') && !source.startsWith('//')) {
		return true;
	}
	return false;
}

/**
 * Converts a local path to a VS Code URI
 */
function localPathToUri(source: string): vscode.Uri {
	if (source.startsWith('file://')) {
		return vscode.Uri.parse(source);
	}
	return vscode.Uri.file(source);
}

/**
 * Validates that the fetched content looks like valid Markdown instructions
 * and not an error page or unexpected content
 */
function isValidInstructionContent(content: string, source: string): { valid: boolean; reason?: string } {
	// Check for empty content
	if (!content || content.trim().length === 0) {
		return { valid: false, reason: 'Empty content received' };
	}

	// Check for common HTML error page indicators (case-insensitive)
	const lowerContent = content.toLowerCase();
	const htmlErrorIndicators = [
		'<!doctype html',
		'<html',
		'<head>',
		'<title>404',
		'<title>401',
		'<title>403',
		'<title>500',
		'page not found',
		'access denied',
		'unauthorized',
		'sign in to',
		'login required'
	];

	// If the content starts with typical HTML indicators, it's likely an error page
	const trimmedLower = lowerContent.trim();
	if (trimmedLower.startsWith('<!doctype') || trimmedLower.startsWith('<html')) {
		// Check if it contains error indicators
		for (const indicator of htmlErrorIndicators) {
			if (lowerContent.includes(indicator)) {
				return { valid: false, reason: 'Received HTML error page instead of instructions content' };
			}
		}
		// Even without explicit error indicators, HTML content is suspicious for a .md file
		return { valid: false, reason: 'Received HTML content instead of Markdown instructions' };
	}

	// Check for GitHub-specific error responses (JSON format)
	if (trimmedLower.startsWith('{')) {
		try {
			const json = JSON.parse(content);
			if (json.message || json.error || json.errors) {
				return { valid: false, reason: `API error: ${json.message || json.error || 'Unknown error'}` };
			}
		} catch {
			// Not valid JSON, could still be valid content
		}
	}

	return { valid: true };
}

/**
 * Options for content fetching
 */
interface FetchContentOptions {
	/** If true, validates content as Markdown instructions (default: true) */
	validateAsInstructions?: boolean;
}

/**
 * Fetches content from a URL or local file path with authentication support
 * for GitHub and Azure DevOps sources.
 */
async function fetchContent(source: string, options: FetchContentOptions = {}): Promise<string> {
	const { validateAsInstructions = true } = options;

	// Handle local file paths
	if (isLocalPath(source)) {
		try {
			const uri = localPathToUri(source);
			const content = await vscode.workspace.fs.readFile(uri);
			return Buffer.from(content).toString('utf8');
		} catch (error) {
			throw new Error(`Failed to read local file ${source}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// Handle remote URLs
	const { isGitHub, isEnterprise } = isGitHubUrl(source);
	const isAzureDevOps = isAzureDevOpsUrl(source);

	const headers: Record<string, string> = {};

	if (isGitHub) {
		headers['Accept'] = 'application/vnd.github.v3.raw';
		const token = await getGitHubToken(isEnterprise);
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}
	} else if (isAzureDevOps) {
		headers['Accept'] = 'text/plain';
		const token = await getAzureDevOpsToken();
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}
	}

	const response = await fetch(source, { headers });
	if (!response.ok) {
		throw new Error(`Failed to fetch from ${source}: ${response.status} ${response.statusText}`);
	}

	const content = await response.text();

	// Validate the content to ensure it's not an error page (only for instruction files)
	if (validateAsInstructions) {
		const validation = isValidInstructionContent(content, source);
		if (!validation.valid) {
			throw new Error(`Invalid content from ${source}: ${validation.reason}`);
		}
	}

	return content;
}

/**
 * Gets the current content of the local instructions file
 */
async function getLocalInstructions(workspaceFolder: vscode.WorkspaceFolder, source: InstructionSource): Promise<string | null> {
	const { fullPath } = getDestinationPath(source);
	const instructionsUri = vscode.Uri.joinPath(workspaceFolder.uri, fullPath);
	try {
		const content = await vscode.workspace.fs.readFile(instructionsUri);
		return Buffer.from(content).toString('utf8');
	} catch {
		return null;
	}
}

/**
 * Writes content to the local instructions file
 */
async function writeLocalInstructions(workspaceFolder: vscode.WorkspaceFolder, content: string, source: InstructionSource): Promise<void> {
	const { folder, fullPath } = getDestinationPath(source);
	const destinationFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, folder);
	const instructionsUri = vscode.Uri.joinPath(workspaceFolder.uri, fullPath);

	// Ensure destination directory exists
	try {
		await vscode.workspace.fs.createDirectory(destinationFolderUri);
	} catch {
		// Directory may already exist
	}

	await vscode.workspace.fs.writeFile(instructionsUri, Buffer.from(content, 'utf8'));
}

/**
 * Detects the primary language of the workspace based on file extensions and project files
 */
async function detectWorkspaceLanguage(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
	const detectedLanguages: string[] = [];

	const languagePatterns: { [key: string]: string[] } = {
		'AL': ['**/*.al', 'app.json'],
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
		'Powershell': ['**/*.ps1']
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
	requireConfirmation: boolean = true,
	session?: SyncSession
): Promise<boolean> {
	try {
		const remoteContent = await fetchContent(source.url);
		const localContent = await getLocalInstructions(workspaceFolder, source);

		if (localContent !== remoteContent) {
			// Check if confirmation is required
			if (requireConfirmation && !session?.confirmAll) {
				const config = vscode.workspace.getConfiguration('instructionSync');
				const confirmBeforeSync = config.get<boolean>('confirmBeforeSync', true);

				if (confirmBeforeSync) {
					const action = localContent === null ? 'create' : 'overwrite';
					const { file } = getDestinationPath(source);
					const folderName = workspaceFolder.name;
					const message = `Instruction Sync: ${action === 'create' ? 'Create' : 'Overwrite'} ${file} in "${folderName}" with ${source.language} instructions?`;

					const result = await vscode.window.showWarningMessage(
						message,
						{ modal: false },
						'Yes',
						'Yes to All',
						'No',
						'Always (disable confirmation)'
					);

					if (result === 'No' || result === undefined) {
						return false;
					}

					if (result === 'Yes to All' && session) {
						session.confirmAll = true;
					}

					if (result === 'Always (disable confirmation)') {
						await config.update('confirmBeforeSync', false, vscode.ConfigurationTarget.Global);
					}
				}
			}

			await writeLocalInstructions(workspaceFolder, remoteContent, source);
			if (showNotifications) {
				const { file } = getDestinationPath(source);
				const folderName = workspaceFolder.name;
				vscode.window.showInformationMessage(
					`Instruction Sync: Updated ${file} in "${folderName}" from ${source.language} configuration`
				);
			}
			return true;
		} else {
			if (showNotifications) {
				const folderName = workspaceFolder.name;
				vscode.window.showInformationMessage(
					`Instruction Sync: Instructions are already up to date for ${source.language} in "${folderName}"`
				);
			}
			return false;
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const folderName = workspaceFolder.name;
		vscode.window.showErrorMessage(
			`Instruction Sync: Failed to sync instructions for ${source.language} in "${folderName}": ${errorMessage}`
		);
		return false;
	}
}

/**
 * Gets the instruction sources from configuration
 */
function getLocalInstructionSources(): InstructionSource[] {
	const config = vscode.workspace.getConfiguration('instructionSync');
	return config.get<InstructionSource[]>('sources', []);
}

/**
 * Fetches and parses the remote configuration file.
 * Uses an in-memory cache to avoid fetching on every sync.
 */
async function fetchRemoteConfig(forceRefresh: boolean = false): Promise<RemoteConfig | null> {
	const config = vscode.workspace.getConfiguration('instructionSync');
	const remoteConfigUrl = config.get<string>('remoteConfigUrl', '');

	if (!remoteConfigUrl) {
		return null;
	}

	const cacheDuration = config.get<number>('remoteConfigCacheDuration', 3600) * 1000; // convert to ms

	// Check cache
	if (!forceRefresh && remoteConfigCache && cacheDuration > 0) {
		const age = Date.now() - remoteConfigCache.timestamp;
		if (age < cacheDuration) {
			return remoteConfigCache.config;
		}
	}

	try {
		// Fetch remote config with authentication but skip Markdown-specific validation
		// since this is a JSON config file, not instruction content
		const content = await fetchContent(remoteConfigUrl, { validateAsInstructions: false });
		const parsed = JSON.parse(content);

		// Validate the structure
		const remoteConf: RemoteConfig = {};

		if (Array.isArray(parsed.sources)) {
			remoteConf.sources = parsed.sources.filter((s: unknown) => {
				if (typeof s !== 'object' || s === null) { return false; }
				const obj = s as Record<string, unknown>;
				return typeof obj.language === 'string' && typeof obj.url === 'string';
			});
		}

		if (typeof parsed.syncOnOpen === 'boolean') {
			remoteConf.syncOnOpen = parsed.syncOnOpen;
		}
		if (typeof parsed.syncOnConfigChange === 'boolean') {
			remoteConf.syncOnConfigChange = parsed.syncOnConfigChange;
		}
		if (typeof parsed.confirmBeforeSync === 'boolean') {
			remoteConf.confirmBeforeSync = parsed.confirmBeforeSync;
		}

		// Parse settings array
		if (Array.isArray(parsed.settings)) {
			remoteConf.settings = parsed.settings.filter((s: unknown) => {
				if (typeof s !== 'object' || s === null) { return false; }
				const obj = s as Record<string, unknown>;
				// Must have scope ('user' or 'workspace') and settings object
				if (obj.scope !== 'user' && obj.scope !== 'workspace') { return false; }
				if (typeof obj.settings !== 'object' || obj.settings === null) { return false; }
				// Language is optional
				if (obj.language !== undefined && typeof obj.language !== 'string') { return false; }
				return true;
			}) as SettingsConfig[];
		}

		// Update cache
		remoteConfigCache = { config: remoteConf, timestamp: Date.now() };

		return remoteConf;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`Failed to fetch remote config from ${remoteConfigUrl}: ${errorMessage}`);
		vscode.window.showErrorMessage(
			`Instruction Sync: Failed to fetch remote configuration: ${errorMessage}`
		);
		// Return cached config if available, even if expired
		return remoteConfigCache?.config ?? null;
	}
}

/**
 * Gets the merged instruction sources from both remote and local configuration.
 * Remote sources are fetched first, then local sources are appended.
 * Local sources can override remote ones for the same language + destination combination.
 */
async function getInstructionSources(forceRefresh: boolean = false): Promise<InstructionSource[]> {
	const localSources = getLocalInstructionSources();
	const remoteConfig = await fetchRemoteConfig(forceRefresh);

	if (!remoteConfig?.sources || remoteConfig.sources.length === 0) {
		return localSources;
	}

	if (localSources.length === 0) {
		return remoteConfig.sources;
	}

	// Merge: local sources override remote sources for the same language + destination
	const merged = new Map<string, InstructionSource>();

	const sourceKey = (s: InstructionSource) => {
		const { fullPath } = getDestinationPath(s);
		return `${s.language.toLowerCase()}::${fullPath}`;
	};

	for (const source of remoteConfig.sources) {
		merged.set(sourceKey(source), source);
	}

	for (const source of localSources) {
		merged.set(sourceKey(source), source);
	}

	return Array.from(merged.values());
}

/**
 * Default blacklist patterns for settings that should never be synced remotely.
 * These are security-sensitive or could cause issues if changed remotely.
 */
const DEFAULT_SETTINGS_BLACKLIST = [
	'terminal.integrated.env.*',
	'terminal.integrated.shellArgs.*',
	'terminal.integrated.automationProfile.*',
	'terminal.integrated.defaultProfile.*',
	'terminal.integrated.profiles.*',
	'security.*',
	'remote.*',
	'extensions.autoUpdate',
	'extensions.autoCheckUpdates',
	'update.*'
];

/**
 * Checks if a setting key is allowed to be synced (not blacklisted).
 * @param settingKey The VS Code setting key to check
 * @returns true if the setting is allowed, false if it's blacklisted
 */
function isSettingAllowed(settingKey: string): boolean {
	const config = vscode.workspace.getConfiguration('instructionSync');
	const userBlacklist = config.get<string[]>('settingsBlacklist', []);

	// Combine default and user blacklist
	const blacklist = [...DEFAULT_SETTINGS_BLACKLIST, ...userBlacklist];

	for (const pattern of blacklist) {
		// Convert glob-like pattern to regex
		// Support wildcard (*) at the end of patterns
		if (pattern.endsWith('.*')) {
			const prefix = pattern.slice(0, -2);
			if (settingKey === prefix || settingKey.startsWith(prefix + '.')) {
				return false;
			}
		} else if (pattern.endsWith('*')) {
			const prefix = pattern.slice(0, -1);
			if (settingKey.startsWith(prefix)) {
				return false;
			}
		} else {
			// Exact match
			if (settingKey === pattern) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Filters settings configurations to remove blacklisted settings.
 * @param settingsConfigs Array of settings configurations from remote config
 * @returns Filtered array with blacklisted settings removed
 */
function filterBlacklistedSettings(settingsConfigs: SettingsConfig[]): SettingsConfig[] {
	return settingsConfigs.map(config => {
		const filteredSettings: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(config.settings)) {
			if (isSettingAllowed(key)) {
				filteredSettings[key] = value;
			} else {
				console.log(`Instruction Sync: Blocked blacklisted setting: ${key}`);
			}
		}
		return {
			...config,
			settings: filteredSettings
		};
	}).filter(config => Object.keys(config.settings).length > 0);
}

/**
 * Gets settings configurations that apply to the detected languages.
 * @param allSettings All settings from remote config
 * @param detectedLanguages Languages detected in the workspace
 * @returns Settings that either have no language filter or match a detected language
 */
function getApplicableSettings(
	allSettings: SettingsConfig[],
	detectedLanguages: string[]
): SettingsConfig[] {
	return allSettings.filter(config => {
		// If no language specified, setting applies to all workspaces
		if (!config.language) {
			return true;
		}
		// Check if the setting's language matches any detected language (case-insensitive)
		return detectedLanguages.some(
			lang => lang.toLowerCase() === config.language!.toLowerCase()
		);
	});
}

/**
 * Computes the changes that would be made by applying settings.
 * @param settingsConfigs Settings to apply
 * @returns Array of changes with old and new values
 */
async function computeSettingsChanges(settingsConfigs: SettingsConfig[]): Promise<SettingChange[]> {
	const changes: SettingChange[] = [];

	for (const config of settingsConfigs) {
		for (const [key, newValue] of Object.entries(config.settings)) {
			// Get the section and property name
			const lastDotIndex = key.lastIndexOf('.');
			const section = lastDotIndex > 0 ? key.substring(0, lastDotIndex) : '';
			const property = lastDotIndex > 0 ? key.substring(lastDotIndex + 1) : key;

			const vsConfig = vscode.workspace.getConfiguration(section);
			const inspected = vsConfig.inspect(property);

			// Get current value based on scope
			const currentValue = config.scope === 'user'
				? inspected?.globalValue
				: inspected?.workspaceValue;

			// Only include if value is different
			if (!deepEqual(currentValue, newValue)) {
				changes.push({
					key,
					oldValue: currentValue,
					newValue,
					scope: config.scope
				});
			}
		}
	}

	return changes;
}

/**
 * Deep equality check for setting values
 */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) { return true; }
	if (a === null || b === null) { return false; }
	if (typeof a !== typeof b) { return false; }

	if (typeof a === 'object' && typeof b === 'object') {
		const aObj = a as Record<string, unknown>;
		const bObj = b as Record<string, unknown>;
		const aKeys = Object.keys(aObj);
		const bKeys = Object.keys(bObj);

		if (aKeys.length !== bKeys.length) { return false; }

		for (const key of aKeys) {
			if (!bKeys.includes(key)) { return false; }
			if (!deepEqual(aObj[key], bObj[key])) { return false; }
		}
		return true;
	}

	return false;
}

/**
 * Formats a value for display in the confirmation dialog
 */
function formatValue(value: unknown): string {
	if (value === undefined) {
		return '(not set)';
	}
	if (typeof value === 'string') {
		return `"${value}"`;
	}
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return String(value);
}

/**
 * Shows a confirmation dialog with the settings changes that will be made.
 * @param changes The changes to display
 * @returns true if user confirms, false otherwise
 */
async function showSettingsConfirmation(changes: SettingChange[]): Promise<boolean> {
	if (changes.length === 0) {
		return true;
	}

	// Group changes by scope for clearer display
	const userChanges = changes.filter(c => c.scope === 'user');
	const workspaceChanges = changes.filter(c => c.scope === 'workspace');

	let message = `Instruction Sync: Apply ${changes.length} setting change(s)?\n\n`;

	if (userChanges.length > 0) {
		message += `User Settings (${userChanges.length}):\n`;
		for (const change of userChanges.slice(0, 5)) {
			message += `  • ${change.key}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}\n`;
		}
		if (userChanges.length > 5) {
			message += `  ... and ${userChanges.length - 5} more\n`;
		}
	}

	if (workspaceChanges.length > 0) {
		if (userChanges.length > 0) { message += '\n'; }
		message += `Workspace Settings (${workspaceChanges.length}):\n`;
		for (const change of workspaceChanges.slice(0, 5)) {
			message += `  • ${change.key}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}\n`;
		}
		if (workspaceChanges.length > 5) {
			message += `  ... and ${workspaceChanges.length - 5} more\n`;
		}
	}

	const result = await vscode.window.showWarningMessage(
		message.trim(),
		{ modal: true },
		'Apply Settings',
		'Cancel'
	);

	return result === 'Apply Settings';
}

/**
 * Applies the computed settings changes to VS Code configuration.
 * @param changes The changes to apply
 */
async function applySettingsChanges(changes: SettingChange[]): Promise<void> {
	for (const change of changes) {
		const lastDotIndex = change.key.lastIndexOf('.');
		const section = lastDotIndex > 0 ? change.key.substring(0, lastDotIndex) : '';
		const property = lastDotIndex > 0 ? change.key.substring(lastDotIndex + 1) : change.key;

		const vsConfig = vscode.workspace.getConfiguration(section);
		const target = change.scope === 'user'
			? vscode.ConfigurationTarget.Global
			: vscode.ConfigurationTarget.Workspace;

		await vsConfig.update(property, change.newValue, target);
	}
}

/**
 * Performs the settings sync from remote configuration.
 * @param detectedLanguages Languages detected in the workspace
 * @param showNotifications Whether to show notifications
 * @returns Number of settings changed
 */
async function performSettingsSync(
	detectedLanguages: string[],
	showNotifications: boolean
): Promise<number> {
	const remoteConfig = await fetchRemoteConfig();

	if (!remoteConfig?.settings || remoteConfig.settings.length === 0) {
		return 0;
	}

	// Filter out blacklisted settings
	const filteredSettings = filterBlacklistedSettings(remoteConfig.settings);

	if (filteredSettings.length === 0) {
		return 0;
	}

	// Get settings applicable to detected languages
	const applicableSettings = getApplicableSettings(filteredSettings, detectedLanguages);

	if (applicableSettings.length === 0) {
		return 0;
	}

	// Compute what changes would be made
	const changes = await computeSettingsChanges(applicableSettings);

	if (changes.length === 0) {
		if (showNotifications) {
			vscode.window.showInformationMessage('Instruction Sync: Settings are already up to date');
		}
		return 0;
	}

	// Show confirmation dialog
	const confirmed = await showSettingsConfirmation(changes);

	if (!confirmed) {
		if (showNotifications) {
			vscode.window.showInformationMessage('Instruction Sync: Settings sync cancelled');
		}
		return 0;
	}

	// Apply the changes
	await applySettingsChanges(changes);

	if (showNotifications) {
		vscode.window.showInformationMessage(
			`Instruction Sync: Applied ${changes.length} setting change(s)`
		);
	}

	return changes.length;
}

/**
 * Main sync function that checks workspace languages and syncs matching instructions.
 * Uses a global lock to ensure only one sync runs at a time, preventing interleaved
 * confirmation dialogs from concurrent triggers (syncOnOpen, configWatcher, manual).
 */
function performSync(showNotifications: boolean = true, forceRefresh: boolean = false): Promise<void> {
	const doSync = async () => {
		await performSyncInternal(showNotifications, forceRefresh);
	};

	// Chain onto any active sync so calls are serialized, not interleaved
	const chained = (activeSyncPromise ?? Promise.resolve()).then(doSync, doSync);
	activeSyncPromise = chained.finally(() => {
		// Only clear if we're still the latest in the chain
		if (activeSyncPromise === chained) {
			activeSyncPromise = null;
		}
	});

	return activeSyncPromise;
}

async function performSyncInternal(showNotifications: boolean, forceRefresh: boolean): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		if (showNotifications) {
			vscode.window.showWarningMessage('Instruction Sync: No workspace folder open');
		}
		return;
	}

	const sources = await getInstructionSources(forceRefresh);

	// Collect all detected languages across all workspace folders for settings sync
	const allDetectedLanguages = new Set<string>();

	const session: SyncSession = { confirmAll: false };

	// Sync instructions if sources are configured
	if (sources.length > 0) {
		for (const workspaceFolder of workspaceFolders) {
			const detectedLanguages = await detectWorkspaceLanguage(workspaceFolder);

			if (detectedLanguages.length === 0) {
				continue;
			}

			// Track all detected languages for settings sync
			detectedLanguages.forEach(lang => allDetectedLanguages.add(lang));

			// Find and sync all matching source configurations
			for (const source of sources) {
				if (source.enabled === false) {
					continue;
				}

				// Case-insensitive language matching
				const matchingLanguage = detectedLanguages.find(
					lang => lang.toLowerCase() === source.language.toLowerCase()
				);

				if (matchingLanguage) {
					await syncInstructions(workspaceFolder, source, showNotifications, true, session);
				}
			}
		}
	} else {
		// Even without sources, detect languages for settings sync
		for (const workspaceFolder of workspaceFolders) {
			const detectedLanguages = await detectWorkspaceLanguage(workspaceFolder);
			detectedLanguages.forEach(lang => allDetectedLanguages.add(lang));
		}
	}

	// Perform settings sync if enabled
	const config = vscode.workspace.getConfiguration('instructionSync');
	const syncSettingsOnOpen = config.get<boolean>('syncSettingsOnOpen', true);

	if (syncSettingsOnOpen) {
		await performSettingsSync(Array.from(allDetectedLanguages), showNotifications);
	}

	// Show message if no sources configured and no settings synced
	if (sources.length === 0 && showNotifications) {
		vscode.window.showInformationMessage(
			'Instruction Sync: No instruction sources configured. Add sources in settings or set a remote configuration URL.'
		);
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

		const sources = await getInstructionSources(true);
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
			const session: SyncSession = { confirmAll: false };
			for (const workspaceFolder of workspaceFolders) {
				await syncInstructions(workspaceFolder, picked.source, true, true, session);
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

	// Register command to set remote config URL
	const setRemoteConfigCommand = vscode.commands.registerCommand('kine-instruction-sync.setRemoteConfig', async () => {
		const config = vscode.workspace.getConfiguration('instructionSync');
		const currentUrl = config.get<string>('remoteConfigUrl', '');

		const url = await vscode.window.showInputBox({
			prompt: 'Enter the URL to the remote configuration JSON file (leave empty to clear)',
			placeHolder: 'https://raw.githubusercontent.com/org/repo/main/.copilot-sync-config.json',
			value: currentUrl,
			validateInput: (value) => {
				if (value && !value.startsWith('http://') && !value.startsWith('https://') && !isLocalPath(value)) {
					return 'Please enter a valid URL (http:// or https://) or a local file path';
				}
				return null;
			}
		});

		if (url === undefined) {
			return; // cancelled
		}

		await config.update('remoteConfigUrl', url || undefined, vscode.ConfigurationTarget.Global);
		remoteConfigCache = null; // clear cache

		if (url) {
			vscode.window.showInformationMessage(`Instruction Sync: Remote configuration URL set. Syncing...`);
			await performSync(true, true);
		} else {
			vscode.window.showInformationMessage('Instruction Sync: Remote configuration URL cleared.');
		}
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

	context.subscriptions.push(syncCommand, forceSyncCommand, addSourceCommand, setRemoteConfigCommand, configWatcher);
}

export function deactivate() { }

// Exported for testing
export { getDestinationPath, isGitHubUrl, isAzureDevOpsUrl, isLocalPath, isValidInstructionContent };
export { isSettingAllowed, filterBlacklistedSettings, getApplicableSettings, deepEqual, formatValue };
export type { InstructionSource, RemoteConfig, SyncSession, SettingsConfig, SettingChange };
