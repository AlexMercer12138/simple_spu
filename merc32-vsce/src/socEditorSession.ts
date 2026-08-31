import {
    HostToWebviewMessage,
    isCurrentDocumentMessage,
    SocActionProgress,
    SocEditorActionType,
    SocEditorViewModel,
    SocGenerationState,
    SocJsonPath,
    WebviewToHostMessage,
} from './socWebviewProtocol';

export type SocMutationMessage = Extract<WebviewToHostMessage, {
    type: 'setValue' | 'unsetValue' | 'addInstance' | 'removeInstance';
}>;

export type SocEditorCommandOutcome = boolean | void;

export interface SocEditorSessionServices {
    currentDocumentVersion(): number;
    normalizeSelection(path: SocJsonPath, previous?: SocJsonPath): SocJsonPath | undefined;
    buildState(selectedPath: SocJsonPath | undefined, status: SocGenerationState): SocEditorViewModel;
    postMessage(message: HostToWebviewMessage): PromiseLike<boolean>;
    mutate(message: SocMutationMessage): Promise<boolean>;
    executeAction(
        type: SocEditorActionType,
        report: (status: SocActionProgress) => Promise<void>,
    ): Promise<SocEditorCommandOutcome>;
    reopenAsText(): Promise<void>;
}

export const IDLE_GENERATION: SocGenerationState = {
    actionId: 0,
    phase: 'idle',
    message: 'No generation run in this editor session.',
};

const ACTION_SUCCESS: Readonly<Record<SocEditorActionType, SocActionProgress>> = {
    autoAssign: { phase: 'success', message: 'Address assignment completed.' },
    validate: { phase: 'success', message: 'Validation completed.' },
    generate: { phase: 'generated', message: 'SoC generation completed.' },
};

const ACTION_FAILURE: Readonly<Record<SocEditorActionType, SocActionProgress>> = {
    autoAssign: { phase: 'error', message: 'Address assignment failed.' },
    validate: { phase: 'error', message: 'Validation failed.' },
    generate: { phase: 'error', message: 'SoC generation failed.' },
};

export class SocEditorSession {
    private mutationQueue = Promise.resolve();
    private stateQueue = Promise.resolve();
    private requestedState = 0;
    private actionId = 0;
    private activeAction: SocEditorActionType | undefined;
    private ready = false;
    private disposed = false;

    private selectedPath: SocJsonPath | undefined;
    private generation: SocGenerationState = { ...IDLE_GENERATION };
    private lastPostedDocumentVersion = 0;

    constructor(private readonly services: SocEditorSessionServices) {}

    async receive(message: WebviewToHostMessage): Promise<void> {
        if (this.disposed) return;

        try {
            await this.receiveMessage(message);
        } catch {
            if (this.disposed) return;
            this.setError('The editor could not process that request.');
            await this.scheduleState();
        }
    }

    private async receiveMessage(message: WebviewToHostMessage): Promise<void> {
        if (message.type === 'ready') {
            this.ready = true;
            await this.scheduleState();
            return;
        }
        if (message.type === 'select') {
            this.selectedPath = this.services.normalizeSelection(message.path, this.selectedPath);
            await this.scheduleState();
            return;
        }
        if (isMutationMessage(message)) {
            await this.enqueueMutation(message);
            return;
        }
        if (message.type === 'reopenAsText') {
            void this.reopenAsText();
            return;
        }
        if (this.activeAction === undefined) {
            this.activeAction = message.type;
            const actionId = ++this.actionId;
            void this.runAction(message.type, actionId);
        }
    }

    async documentChanged(): Promise<void> {
        if (this.disposed || !this.ready
            || this.services.currentDocumentVersion() === this.lastPostedDocumentVersion) {
            return;
        }
        await this.scheduleState();
    }

    dispose(): void {
        this.disposed = true;
    }

    private scheduleState(): Promise<void> {
        if (!this.ready || this.disposed) return Promise.resolve();

        const request = ++this.requestedState;
        return this.enqueueState(async () => {
            if (request !== this.requestedState) return;
            const state = this.services.buildState(this.selectedPath, this.generation);
            this.selectedPath = state.selectedPath;
            await this.services.postMessage({ type: 'state', value: state });
            this.lastPostedDocumentVersion = state.documentVersion;
        });
    }

    private enqueueState(operation: () => Promise<void>): Promise<void> {
        const queued = this.stateQueue.then(async () => {
            if (this.disposed) return;
            await operation();
        });
        const settled = queued.catch(() => undefined);
        this.stateQueue = settled;
        return settled;
    }

    private enqueueMutation(message: SocMutationMessage): Promise<void> {
        const queued = this.mutationQueue.then(() => this.runMutation(message));
        const settled = queued.catch(() => undefined);
        this.mutationQueue = settled;
        return settled;
    }

    private async runMutation(message: SocMutationMessage): Promise<void> {
        if (this.disposed) return;
        if (!isCurrentDocumentMessage(message, this.services.currentDocumentVersion())) {
            this.setError('The configuration changed. Review the refreshed values and retry.');
            await this.scheduleState();
            return;
        }

        try {
            if (!await this.services.mutate(message)) {
                this.setError('VS Code could not apply the configuration edit.');
            }
        } catch (error) {
            this.setError(error instanceof Error
                ? error.message
                : 'VS Code could not apply the configuration edit.');
        }
        await this.scheduleState();
    }

    private async runAction(type: SocEditorActionType, actionId: number): Promise<void> {
        let reportedTerminal: SocActionProgress['phase'] | undefined;
        try {
            const outcome = await this.services.executeAction(
                type,
                (status) => {
                    reportedTerminal = isTerminalPhase(status.phase) ? status.phase : undefined;
                    return this.reportAction(actionId, type, status);
                },
            );
            if (outcome === false && reportedTerminal !== 'error') {
                await this.reportAction(actionId, type, ACTION_FAILURE[type]);
            } else if (reportedTerminal === undefined) {
                await this.reportAction(actionId, type, ACTION_SUCCESS[type]);
            }
        } catch {
            if (reportedTerminal !== 'error') {
                await this.reportAction(actionId, type, ACTION_FAILURE[type]);
            }
        } finally {
            if (this.actionId === actionId) this.activeAction = undefined;
            await this.scheduleState();
        }
    }

    private reportAction(
        actionId: number,
        action: SocEditorActionType,
        progress: SocActionProgress,
    ): Promise<void> {
        const generation: SocGenerationState = { ...progress, actionId, action };
        this.generation = generation;
        return this.enqueueState(async () => {
            await this.services.postMessage({ type: 'generationStatus', ...generation });
        });
    }

    private async reopenAsText(): Promise<void> {
        try {
            await this.services.reopenAsText();
        } catch {
            this.setError('VS Code could not reopen the configuration as text.');
            await this.scheduleState();
        }
    }

    private setError(message: string): void {
        this.generation = { actionId: this.actionId, phase: 'error', message };
    }
}

function isMutationMessage(message: WebviewToHostMessage): message is SocMutationMessage {
    return message.type === 'setValue' || message.type === 'unsetValue'
        || message.type === 'addInstance' || message.type === 'removeInstance';
}

function isTerminalPhase(phase: SocActionProgress['phase']): boolean {
    return phase === 'success' || phase === 'generated' || phase === 'error';
}
