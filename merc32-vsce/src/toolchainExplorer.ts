import * as vscode from 'vscode';
import { COMMANDS } from './constants';
import { ToolchainCommandState } from './extensionCommands';

type NodeKind = 'group' | 'command';

interface NodeSpec {
    label: string;
    kind: NodeKind;
    description?: string;
    icon?: string;
    command?: vscode.Command;
    children?: NodeSpec[];
}

export class Merc32ToolchainExplorer implements vscode.TreeDataProvider<NodeSpec>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<NodeSpec | undefined | null | void>();
    readonly onDidChangeTreeData = this.changeEmitter.event;

    constructor(private readonly state: ToolchainCommandState) {}

    refresh(): void {
        this.changeEmitter.fire();
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }

    getTreeItem(element: NodeSpec): vscode.TreeItem {
        const collapsibleState = element.children
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(element.label, collapsibleState);
        item.description = element.description;
        item.command = element.command;
        if (element.icon) {
            item.iconPath = new vscode.ThemeIcon(element.icon);
        }
        return item;
    }

    getChildren(element?: NodeSpec): NodeSpec[] {
        if (element) {
            return element.children || [];
        }

        return [
            this.buildGroup(),
        ];
    }

    private buildGroup(): NodeSpec {
        return {
            label: 'Build',
            kind: 'group',
            icon: 'tools',
            children: [
                commandNode('Build Active File', COMMANDS.compile, 'Run default build for .c or .asm', 'play'),
                commandNode('Assemble ASM', COMMANDS.assembleActive, 'Assemble active .asm file', 'file-binary'),
                commandNode('Compile C to ASM', COMMANDS.compileCToAsm, 'Emit MERC32 assembly from active .c file', 'file-code'),
                commandNode('Build C to ROM', COMMANDS.buildCToRom, 'Compile C and assemble configured output', 'package'),
                commandNode('Select Compile Mode', COMMANDS.selectCompileMode, `Current: ${this.state.currentMode}`, 'settings-gear'),
            ],
        };
    }
}

function commandNode(label: string, command: string, description: string, icon: string): NodeSpec {
    return {
        label,
        kind: 'command',
        description,
        icon,
        command: { command, title: label },
    };
}
