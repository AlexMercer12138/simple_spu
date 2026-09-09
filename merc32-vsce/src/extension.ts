import * as vscode from 'vscode';
import { AssemblyRunner } from './assemblyRunner';
import { CDiagnostics } from './cDiagnostics';
import { registerCli } from './cliIntegration';
import { OUTPUT_CHANNEL_NAME, SOC_EDITOR_VIEW_TYPE, SOC_VIEW_IDS } from './constants';
import { registerAssemblerCommands, ToolchainCommandState } from './extensionCommands';
import { loadCatalog, ModuleCatalog } from './soc';
import { registerSocCommands } from './socCommands';
import { SocDiagnostics } from './socDiagnostics';
import { Merc32SocEditorProvider } from './socEditorProvider';
import {
    Merc32ArtifactStore,
    Merc32ArtifactsProvider,
    registerSocExplorerCommands,
    SocActionProvider,
    SocConfigurationProvider,
} from './socExplorer';
import { Merc32ToolchainExplorer } from './toolchainExplorer';
import { DEFAULT_COMPILE_MODE } from './types';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(registerCli(context, output));
    const runner = new AssemblyRunner(output);
    const cDiagnostics = new CDiagnostics();
    const state: ToolchainCommandState = {
        currentMode: DEFAULT_COMPILE_MODE,
    };
    const toolchainProvider = new Merc32ToolchainExplorer(state);
    const reportHostError = (error: unknown) => {
        output.appendLine(`MERC32 extension host error: ${errorMessage(error)}`);
    };
    const artifactStore = new Merc32ArtifactStore(context.workspaceState, vscode, reportHostError);
    await artifactStore.refresh();

    let catalog: ModuleCatalog | undefined;
    let catalogFailureMessage: string | undefined;
    try {
        const resourceUri = vscode.Uri.joinPath(context.extensionUri, 'resources');
        catalog = loadCatalog(resourceUri.fsPath);
    } catch (error) {
        catalogFailureMessage = `MERC32 SoC tools were disabled: ${errorMessage(error)}`;
        output.appendLine(catalogFailureMessage);
        output.show(true);
    }

    const configurationsProvider = await SocConfigurationProvider.create(
        vscode,
        catalog !== undefined,
        reportHostError,
    );
    const actionProvider = new SocActionProvider(catalog !== undefined, vscode);
    const artifactsProvider = new Merc32ArtifactsProvider(artifactStore, vscode);

    context.subscriptions.push(
        output,
        runner,
        cDiagnostics,
        artifactStore,
        configurationsProvider,
        actionProvider,
        toolchainProvider,
        artifactsProvider,
        vscode.window.registerTreeDataProvider(SOC_VIEW_IDS.configurations, configurationsProvider),
        vscode.window.registerTreeDataProvider(SOC_VIEW_IDS.generate, actionProvider),
        vscode.window.registerTreeDataProvider(SOC_VIEW_IDS.build, toolchainProvider),
        vscode.window.registerTreeDataProvider(SOC_VIEW_IDS.artifacts, artifactsProvider),
        ...registerAssemblerCommands(
            runner,
            state,
            artifactStore,
            () => toolchainProvider.refresh(),
            cDiagnostics,
        ),
        ...registerSocExplorerCommands(configurationsProvider, artifactsProvider, vscode),
    );

    if (catalogFailureMessage) {
        void Promise.resolve(vscode.window.showErrorMessage(catalogFailureMessage)).catch(reportHostError);
    }
    if (!catalog) return;

    const diagnostics = new SocDiagnostics(catalog, vscode);
    const editor = new Merc32SocEditorProvider(context.extensionUri, catalog, vscode);
    context.subscriptions.push(
        diagnostics,
        vscode.window.registerCustomEditorProvider(
            SOC_EDITOR_VIEW_TYPE,
            editor,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        ...registerSocCommands(context, {
            catalog,
            diagnostics,
            output,
            artifacts: artifactStore,
            vscodeApi: vscode,
        }),
    );
}

export function deactivate() {}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
