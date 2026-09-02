import { CType } from './types';
import { SourceLocation } from './source';

export type IRValue = number | string;
export interface IRInstruction { readonly op: string; readonly args: readonly IRValue[]; readonly dest?: number; readonly location?: SourceLocation; }
export interface IRBlock { readonly label: string; readonly instructions: readonly IRInstruction[]; }
export interface IRFunction { readonly name: string; readonly returnType?: CType; readonly parameters: readonly CType[]; readonly parameterNames?: readonly string[]; readonly localNames?: readonly string[]; readonly returnLabel?: string; readonly blocks: readonly IRBlock[]; }
export interface Merc32Module { readonly abi: 'merc32-c-v1'; readonly functions: readonly IRFunction[]; readonly globals: readonly string[]; }
