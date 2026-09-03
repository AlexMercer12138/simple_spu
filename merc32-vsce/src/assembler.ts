import { AssemblyDebugInfo } from './types';
import { AssemblerPreprocessor, PreprocessOptions } from './preprocessor';

type NumericRadix = 2 | 10 | 16;

interface NumericLiteral {
    value: number;
    radix: NumericRadix;
    prefixed: boolean;
}

const NUMERIC_LITERAL_PATTERN = /^([+-]?)(?:(?:0[xX]([0-9a-fA-F]+))|(?:0[bB]([01]+))|(\d+))$/;

function parseQuotedByteString(token: string): number[] | undefined {
    const text = token.trim();
    if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) {
        return undefined;
    }

    const bytes: number[] = [];
    for (let i = 1; i < text.length - 1; i++) {
        let code: number;
        const char = text[i];
        if (char === '\\') {
            i++;
            if (i >= text.length - 1) {
                return undefined;
            }
            const escaped = text[i];
            if (escaped === 'n') code = 0x0A;
            else if (escaped === 'r') code = 0x0D;
            else if (escaped === 't') code = 0x09;
            else if (escaped === '0') code = 0x00;
            else if (escaped === '\\') code = 0x5C;
            else if (escaped === '"') code = 0x22;
            else if (escaped === 'x') {
                const hex = text.slice(i + 1, i + 3);
                if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
                    return undefined;
                }
                code = Number.parseInt(hex, 16);
                i += 2;
            } else {
                return undefined;
            }
        } else {
            code = char.charCodeAt(0);
        }

        if (code < 0 || code > 0xFF) {
            return undefined;
        }
        bytes.push(code);
    }

    return bytes;
}

function parseNumericLiteral(token: string): NumericLiteral | undefined {
    const bytes = parseQuotedByteString(token);
    if (bytes !== undefined) {
        if (bytes.length < 1 || bytes.length > 2) {
            return undefined;
        }
        return {
            value: bytes.reduce((value, byte) => (value << 8) | byte, 0),
            radix: 16,
            prefixed: true,
        };
    }

    const match = token.trim().match(NUMERIC_LITERAL_PATTERN);
    if (!match) {
        return undefined;
    }

    const sign = match[1] === '-' ? -1 : 1;
    const hexDigits = match[2];
    const binDigits = match[3];
    const decDigits = match[4];
    const radix: NumericRadix = hexDigits ? 16 : binDigits ? 2 : 10;
    const digits = hexDigits || binDigits || decDigits;
    const magnitude = Number.parseInt(digits, radix);
    if (Number.isNaN(magnitude)) {
        return undefined;
    }

    return {
        value: sign * magnitude,
        radix,
        prefixed: radix !== 10,
    };
}

function parseRegisterIndex(regStr: string): number | undefined {
    const match = regStr.trim().match(/^r(\d+)$/);
    if (!match) {
        return undefined;
    }

    const index = Number.parseInt(match[1], 10);
    if (!Number.isInteger(index) || index < 0 || index > 15) {
        return undefined;
    }

    return index;
}

export enum InstructionType {
    SET = 0x0,
    ADD = 0x1,
    SUB = 0x2,
    AND = 0x3,
    OR = 0x4,
    XOR = 0x5,
    SLL = 0x6,
    SRL = 0x7,
    SRA = 0x8,
    MUL = 0x9,
    DIV = 0xA,
    DIVU = 0xB,
    REM = 0xC,
    REMU = 0xD,
    LW = 0x10,
    LH = 0x11,
    LHU = 0x12,
    LB = 0x13,
    LBU = 0x14,
    SW = 0x15,
    SH = 0x16,
    SB = 0x17,
    BZ = 0x20,
    BNZ = 0x21,
    JAL = 0x22,
    CMP = 0x23,
}

enum CompareCondition {
    EQ = 0x0,
    NE = 0x1,
    SGE = 0x2,
    SLT = 0x3,
    SGT = 0x4,
    SLE = 0x5,
    UGE = 0x6,
    ULT = 0x7,
    UGT = 0x8,
    ULE = 0x9,
}

export interface Instruction {
    instType: InstructionType;
    operands: string[];
    lineNum: number;
    lineContent: string;
}

export interface ParsedLine {
    label: string | null;
    instruction: Instruction | null;
    lineContent: string;
}

export interface AssemblyResult extends AssemblyDebugInfo {
    machineCodes: number[];
    programName?: string;
    entryLabel?: string;
    origin: number;
    preprocessedCode: string;
}

export class SimpleCPUAssembler {
    private symbols: Map<string, number> = new Map();
    private instructions: Instruction[] = [];
    private errors: string[] = [];

    removeComments(line: string): string {
        let result = '';
        let inQuote = false;
        let escaped = false;
        for (let index = 0; index < line.length; index++) {
            if (inQuote) {
                result += line[index];
                if (escaped) escaped = false;
                else if (line[index] === '\\') escaped = true;
                else if (line[index] === '"') inQuote = false;
                continue;
            }
            if (line[index] === '"') {
                result += line[index];
                inQuote = true;
                continue;
            }
            if (line[index] === '/' && line[index + 1] === '/') break;
            if (line[index] === '/' && line[index + 1] === '*') {
                const end = line.indexOf('*/', index + 2);
                if (end < 0) break;
                index = end + 1;
                continue;
            }
            result += line[index];
        }
        return result.trim();
    }

    extractLabel(line: string): [string | null, string] {
        const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)[:\uff1a]\s*(.*)/);
        if (match) {
            return [match[1], match[2].trim()];
        }
        return [null, line];
    }

    isValidRegister(regStr: string): boolean {
        return parseRegisterIndex(regStr) !== undefined;
    }

    parseRegister(regStr: string): number {
        regStr = regStr.trim();
        if (!/^r\d+$/.test(regStr)) {
            throw new Error(`无效的寄存器格式: ${regStr} (应为 rx)`);
        }

        const num = parseRegisterIndex(regStr);
        if (num !== undefined) {
            return num;
        }
        throw new Error(`寄存器编号越界: ${regStr} (应为 r0-r15)`);
    }

    parseImmediate(immStr: string, bits: number = 16): number {
        immStr = immStr.trim();
        const parsed = parseNumericLiteral(immStr);
        if (!parsed) {
            throw new Error(`无效的立即数: ${immStr}`);
        }

        const value = parsed.value;
        const unsignedLimit = 2 ** bits;
        if (parsed.prefixed && value >= 0) {
            const maxVal = unsignedLimit - 1;
            if (value < 0 || value > maxVal) {
                throw new Error(`立即数越界: ${value} (应在 0x0000 到 0x${maxVal.toString(16).toUpperCase()} 之间)`);
            }
        } else {
            const maxVal = 2 ** (bits - 1) - 1;
            const minVal = -(2 ** (bits - 1));
            if (value < minVal || value > maxVal) {
                throw new Error(`立即数越界: ${value} (应在 ${minVal} 到 ${maxVal} 之间)`);
            }
        }

        if (value < 0) {
            return unsignedLimit + value;
        }
        return value;
    }

    parseUnsignedImmediate(immStr: string, bits: number = 16): number {
        const parsed = parseNumericLiteral(immStr.trim());
        const maxVal = (2 ** bits) - 1;
        if (!parsed || parsed.value < 0 || parsed.value > maxVal) {
            throw new Error(`Unsigned immediate out of range: ${immStr} (expected 0..${maxVal})`);
        }
        return parsed.value;
    }

    isImmediate(token: string): boolean {
        return parseNumericLiteral(token) !== undefined;
    }

    splitOperands(operandStr: string): string[] {
        const operands: string[] = [];
        let current = "";
        let inString = false;
        let escape = false;

        for (const char of operandStr) {
            if (escape) {
                current += char;
                escape = false;
                continue;
            }
            if (inString && char === '\\') {
                current += char;
                escape = true;
                continue;
            }
            if (char === '"') {
                current += char;
                inString = !inString;
                continue;
            }
            if (char === ',' && !inString) {
                if (current.trim()) {
                    operands.push(current.trim());
                }
                current = "";
                continue;
            }
            current += char;
        }

        if (inString) {
            throw new Error("字符串立即数缺少结束双引号");
        }
        if (current.trim()) {
            operands.push(current.trim());
        }
        return operands;
    }

    tokenizeOperands(operandStr: string): string[] {
        const tokens: string[] = [];
        let current = "";
        let i = 0;
        while (i < operandStr.length) {
            const c = operandStr[i];
            if (c === '"') {
                if (current.trim()) {
                    tokens.push(current.trim());
                    current = "";
                }
                let literal = '"';
                i++;
                let closed = false;
                while (i < operandStr.length) {
                    const next = operandStr[i];
                    literal += next;
                    i++;
                    if (next === '\\' && i < operandStr.length) {
                        literal += operandStr[i];
                        i++;
                        continue;
                    }
                    if (next === '"') {
                        closed = true;
                        break;
                    }
                }
                if (!closed) {
                    throw new Error("字符串立即数缺少结束双引号");
                }
                tokens.push(literal);
                continue;
            }
            if (/\s/.test(c)) {
                if (current.trim()) {
                    tokens.push(current.trim());
                    current = "";
                }
                i++;
                continue;
            }
            if (i + 1 < operandStr.length) {
                const twoChar = operandStr.substring(i, i + 2);
                if (['==', '!=', '>=', '<='].includes(twoChar)) {
                    if (current.trim()) {
                        tokens.push(current.trim());
                    }
                    tokens.push(twoChar);
                    current = "";
                    i += 2;
                    continue;
                }
            }
            if (c === '<' && i + 1 < operandStr.length && operandStr[i + 1] === '<') {
                if (current.trim()) {
                    tokens.push(current.trim());
                }
                tokens.push('<<');
                current = "";
                i += 2;
                continue;
            }
            if (c === '>' && i + 2 < operandStr.length && operandStr[i + 1] === '>' && operandStr[i + 2] === '>') {
                if (current.trim()) {
                    tokens.push(current.trim());
                }
                tokens.push('>>>');
                current = "";
                i += 3;
                continue;
            }
            if (c === '>' && i + 1 < operandStr.length && operandStr[i + 1] === '>') {
                if (current.trim()) {
                    tokens.push(current.trim());
                }
                tokens.push('>>');
                current = "";
                i += 2;
                continue;
            }

            if (c === '0' && i + 1 < operandStr.length && 'xXbB'.includes(operandStr[i + 1])) {
                if (current.trim()) {
                    tokens.push(current.trim());
                    current = "";
                }
                current += c;
                i++;
                current += operandStr[i];
                i++;
                while (i < operandStr.length && (/[a-zA-Z0-9]/.test(operandStr[i]) || 'xXbB'.includes(operandStr[i]))) {
                    current += operandStr[i];
                    i++;
                }
                tokens.push(current);
                current = "";
                continue;
            }
            if (/\d/.test(c) && current === "") {
                current += c;
                i++;
                while (i < operandStr.length && /\d/.test(operandStr[i])) {
                    current += operandStr[i];
                    i++;
                }
                tokens.push(current);
                current = "";
                continue;
            }
            if ('[]()&|^'.includes(c)) {
                if (current.trim()) {
                    tokens.push(current.trim());
                }
                tokens.push(c);
                current = "";
                i++;
                continue;
            }
            if ('+-'.includes(c)) {
                if (current.trim()) {
                    tokens.push(current.trim());
                    tokens.push(c);
                    current = "";
                    i++;
                    continue;
                }
                // 检查是否是带符号数字的一部分（如 -1, +10, -0xAB, +0b11）
                const previous = tokens[tokens.length - 1];
                const canStartSignedNumber = !previous || ['[', '(', '+', '-', '&', '|', '^', '<<', '>>', '>>>', '==', '!=', '>=', '<=', '<', '>'].includes(previous);
                if (canStartSignedNumber && i + 1 < operandStr.length && /\d/.test(operandStr[i + 1])) {
                    current += c;
                    i++;
                    current += operandStr[i];
                    i++;
                    while (i < operandStr.length && (/[a-zA-Z0-9]/.test(operandStr[i]) || 'xXbB'.includes(operandStr[i]))) {
                        current += operandStr[i];
                        i++;
                    }
                    tokens.push(current);
                    current = "";
                    continue;
                }
                tokens.push(c);
                i++;
                continue;
            }
            current += c;
            i++;
        }
        if (current.trim()) {
            tokens.push(current.trim());
        }
        return tokens;
    }

    parseMov(operands: string[], lineNum: number, lineContent: string): Instruction {
        if (operands.length < 1) {
            throw new Error("mov 指令需要操作数");
        }

        const firstOp = operands[0].trim();
        if (firstOp.startsWith('[')) {
            if (operands.length !== 2) {
                throw new Error("mov 内存写格式错误，应为: mov [addr], rd");
            }
            const dataReg = operands[1]?.trim();
            if (!dataReg || !this.isValidRegister(dataReg)) {
                throw new Error("mov 内存写需要数据寄存器: mov [addr], rd");
            }
            const [base, offset] = this.parseMemoryAddress(firstOp, 'mov');
            return { instType: InstructionType.SW, operands: [dataReg, base, offset], lineNum, lineContent };
        }

        if (operands.length !== 2) {
            throw new Error("mov 指令格式错误，应为: mov rd, src");
        }

        const destReg = operands[0];
        const srcStr = operands[1];
        const tokens = this.tokenizeOperands(srcStr);

        if (tokens.length === 1 && this.isImmediate(tokens[0])) {
            return { instType: InstructionType.SET, operands: [destReg, tokens[0]], lineNum, lineContent };
        }

        if (tokens.length === 1 && /^r\d+$/.test(tokens[0])) {
            return { instType: InstructionType.ADD, operands: [destReg, tokens[0], '0'], lineNum, lineContent };
        }

        if (tokens.length >= 3 && tokens[0] === '[') {
            const [base, offset] = this.parseMemoryAddress(srcStr, 'mov');
            return { instType: InstructionType.LW, operands: [destReg, base, offset], lineNum, lineContent };
        }

        if (tokens.length === 3) {
            const rs2 = tokens[0];
            const op = tokens[1];
            const rs1OrImm = tokens[2];

            const opMap: Record<string, InstructionType> = {
                '+': InstructionType.ADD,
                '-': InstructionType.SUB,
                '&': InstructionType.AND,
                '|': InstructionType.OR,
                '^': InstructionType.XOR,
                '<<': InstructionType.SLL,
                '>>': InstructionType.SRL,
                '>>>': InstructionType.SRA,
            };

            if (op in opMap) {
                return { instType: opMap[op], operands: [destReg, rs2, rs1OrImm], lineNum, lineContent };
            }
        }

        throw new Error(`无法识别的 mov 格式: ${srcStr}`);
    }

    parseAluInstruction(
        mnemonic: string,
        instType: InstructionType,
        operands: string[],
        lineNum: number,
        lineContent: string,
    ): Instruction {
        if (operands.length !== 3) {
            throw new Error(`${mnemonic} format must be: ${mnemonic} rd, rs2, rs1|imm`);
        }

        const [rd, rs2, rhs] = operands.map((operand) => operand.trim());
        if (!this.isValidRegister(rd)) {
            throw new Error(`${mnemonic} destination must be a register: ${rd}`);
        }
        if (!this.isValidRegister(rs2)) {
            throw new Error(`${mnemonic} left operand must be a register: ${rs2}`);
        }
        if (!this.isValidRegister(rhs) && !this.isImmediate(rhs)) {
            throw new Error(`${mnemonic} right operand must be a register or immediate: ${rhs}`);
        }
        if (this.isImmediate(rhs)) {
            this.parseImmediate(rhs, 16);
        }

        return { instType, operands: [rd, rs2, rhs], lineNum, lineContent };
    }

    parseMemoryAddress(address: string, mnemonic: string): [string, string] {
        const tokens = this.tokenizeOperands(address.trim());
        if (tokens[0] !== '[' || tokens[tokens.length - 1] !== ']') {
            throw new Error(`${mnemonic} memory address must be enclosed in brackets: ${address}`);
        }

        tokens.shift();
        tokens.pop();
        let base: string;
        let offset: string;
        if (tokens.length === 1) {
            [base] = tokens;
            offset = '0';
        } else if (tokens.length === 3 && tokens[1] === '+') {
            [base, , offset] = tokens;
        } else {
            throw new Error(`${mnemonic} memory address format must be: [rs2 + rs1|imm]`);
        }

        if (!this.isValidRegister(base)) {
            throw new Error(`${mnemonic} memory base must be a register: ${base}`);
        }
        if (!this.isValidRegister(offset) && !this.isImmediate(offset)) {
            throw new Error(`${mnemonic} memory offset must be a register or immediate: ${offset}`);
        }
        if (this.isImmediate(offset)) {
            this.parseImmediate(offset, 16);
        }
        return [base, offset];
    }

    parseMemoryInstruction(
        mnemonic: string,
        instType: InstructionType,
        load: boolean,
        operands: string[],
        lineNum: number,
        lineContent: string,
    ): Instruction {
        if (operands.length !== 2) {
            const format = load ? `${mnemonic} rd, [rs2 + rs1|imm]` : `${mnemonic} [rs2 + rs1|imm], rd`;
            throw new Error(`${mnemonic} format must be: ${format}`);
        }

        const dataRegister = operands[load ? 0 : 1].trim();
        if (!this.isValidRegister(dataRegister)) {
            const role = load ? 'destination' : 'source';
            throw new Error(`${mnemonic} ${role} must be a register: ${dataRegister}`);
        }
        const [base, offset] = this.parseMemoryAddress(operands[load ? 1 : 0], mnemonic);
        return { instType, operands: [dataRegister, base, offset], lineNum, lineContent };
    }

    parseJmp(operands: string[], lineNum: number, lineContent: string): Instruction {
        if (operands.length < 1 || operands.length > 2) {
            throw new Error("jmp 指令格式错误，应为: jmp target[, rd]");
        }

        const rd = operands[1]?.trim() || 'r0';
        const targetTokens = this.tokenizeOperands(operands[0]);
        let base: string;
        let offset: string;

        if (targetTokens.length === 1) {
            base = 'r0';
            offset = targetTokens[0];
        } else if (targetTokens.length === 3 && ['+', '-'].includes(targetTokens[1])) {
            base = targetTokens[0];
            offset = targetTokens[2];
            if (targetTokens[1] === '-') {
                if (!this.isImmediate(offset)) {
                    throw new Error("jmp 只支持寄存器减立即数: jmp rx - imm[, rd]");
                }
                offset = this.negateImmediateToken(offset);
            }
        } else {
            throw new Error("jmp 目标格式错误，应为 imm、rx、rx + imm、rx - imm 或 rx1 + rx2");
        }

        return { instType: InstructionType.JAL, operands: [rd, base, offset], lineNum, lineContent };
    }

    parseCmp(operands: string[], lineNum: number, lineContent: string, unsigned: boolean): Instruction {
        if (operands.length !== 2) {
            throw new Error("cmp format must be: cmp rd, rs2 <op> rhs");
        }

        const rd = operands[0].trim();
        if (!this.isValidRegister(rd)) {
            throw new Error(`cmp destination must be a register: ${rd}`);
        }

        const expression = this.tokenizeOperands(operands[1]);
        if (expression.length !== 3) {
            throw new Error(`cmp expression format must be: rs2 <op> rhs: ${operands[1]}`);
        }

        const [rs2, operator, rhs] = expression;
        if (!this.isValidRegister(rs2)) {
            throw new Error(`cmp left operand must be a register: ${rs2}`);
        }

        const commonMap: Record<string, CompareCondition> = {
            '==': CompareCondition.EQ,
            '!=': CompareCondition.NE,
        };
        const signedMap: Record<string, CompareCondition> = {
            ...commonMap,
            '>=': CompareCondition.SGE,
            '<': CompareCondition.SLT,
            '>': CompareCondition.SGT,
            '<=': CompareCondition.SLE,
        };
        const unsignedMap: Record<string, CompareCondition> = {
            ...commonMap,
            '>=': CompareCondition.UGE,
            '<': CompareCondition.ULT,
            '>': CompareCondition.UGT,
            '<=': CompareCondition.ULE,
        };
        const condition = (unsigned ? unsignedMap : signedMap)[operator];
        if (condition === undefined) {
            throw new Error(`Unsupported cmp comparison operator: ${operator}`);
        }

        if (!this.isValidRegister(rhs) && !this.isImmediate(rhs)) {
            throw new Error(`cmp right operand must be a register or immediate: ${rhs}`);
        }
        if (this.isImmediate(rhs)) {
            this.parseImmediate(rhs, 16);
        }

        return {
            instType: InstructionType.CMP,
            operands: [String(condition), rd, rs2, rhs],
            lineNum,
            lineContent,
        };
    }

    parseBranch(operands: string[], lineNum: number, lineContent: string, instType: InstructionType.BZ | InstructionType.BNZ): Instruction {
        const mnemonic = instType === InstructionType.BZ ? 'bz' : 'bnz';
        if (operands.length !== 2) {
            throw new Error(`${mnemonic} format must be: ${mnemonic} rd, rs2 + target`);
        }

        const rd = operands[0].trim();
        if (!this.isValidRegister(rd)) {
            throw new Error(`${mnemonic} tested operand must be a register: ${rd}`);
        }

        const targetTokens = this.tokenizeOperands(operands[1]);
        if (targetTokens.length !== 3 || targetTokens[1] !== '+') {
            throw new Error(`${mnemonic} target format must be: rs2 + (u16|label|rs1)`);
        }

        const [rs2, , target] = targetTokens;
        if (!this.isValidRegister(rs2)) {
            throw new Error(`${mnemonic} target base must be a register: ${rs2}`);
        }
        if (this.isValidRegister(target)) {
            return { instType, operands: [rd, rs2, target], lineNum, lineContent };
        }

        if (!this.isImmediate(target)) {
            throw new Error(`${mnemonic} target must be a register, label, or unsigned 16-bit immediate: ${target}`);
        }
        const immediate = this.parseUnsignedImmediate(target, 16);
        if (rs2 === 'r0' && (immediate & 0x3) !== 0) {
            throw new Error(`${mnemonic} direct target must be 4-byte aligned: ${target}`);
        }

        return { instType, operands: [rd, rs2, target], lineNum, lineContent };
    }

    negateImmediateToken(token: string): string {
        const parsed = parseNumericLiteral(token);
        if (!parsed) {
            throw new Error(`无效的立即数: ${token}`);
        }
        return String(-parsed.value);
    }

    parseLine(line: string, lineNum: number): ParsedLine {
        line = this.removeComments(line);
        if (!line) {
            return { label: null, instruction: null, lineContent: line };
        }

        const [label, code] = this.extractLabel(line);
        if (!code) {
            return { label, instruction: null, lineContent: line };
        }

        const parts = code.split(/\s+/);
        const mnemonic = parts[0];
        const operandStr = parts.slice(1).join(' ');
        const operands = this.splitOperands(operandStr);

        let inst: Instruction;
        if (mnemonic === 'mov') {
            inst = this.parseMov(operands, lineNum, line);
        } else if (mnemonic === 'mul') {
            inst = this.parseAluInstruction(mnemonic, InstructionType.MUL, operands, lineNum, line);
        } else if (mnemonic === 'div') {
            inst = this.parseAluInstruction(mnemonic, InstructionType.DIV, operands, lineNum, line);
        } else if (mnemonic === 'divu') {
            inst = this.parseAluInstruction(mnemonic, InstructionType.DIVU, operands, lineNum, line);
        } else if (mnemonic === 'rem') {
            inst = this.parseAluInstruction(mnemonic, InstructionType.REM, operands, lineNum, line);
        } else if (mnemonic === 'remu') {
            inst = this.parseAluInstruction(mnemonic, InstructionType.REMU, operands, lineNum, line);
        } else if (mnemonic === 'lw') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.LW, true, operands, lineNum, line);
        } else if (mnemonic === 'lh') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.LH, true, operands, lineNum, line);
        } else if (mnemonic === 'lhu') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.LHU, true, operands, lineNum, line);
        } else if (mnemonic === 'lb') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.LB, true, operands, lineNum, line);
        } else if (mnemonic === 'lbu') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.LBU, true, operands, lineNum, line);
        } else if (mnemonic === 'sw') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.SW, false, operands, lineNum, line);
        } else if (mnemonic === 'sh') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.SH, false, operands, lineNum, line);
        } else if (mnemonic === 'sb') {
            inst = this.parseMemoryInstruction(mnemonic, InstructionType.SB, false, operands, lineNum, line);
        } else if (mnemonic === 'jmp') {
            inst = this.parseJmp(operands, lineNum, line);
        } else if (mnemonic === 'cmp') {
            inst = this.parseCmp(operands, lineNum, line, false);
        } else if (mnemonic === 'cmpu') {
            inst = this.parseCmp(operands, lineNum, line, true);
        } else if (mnemonic === 'bz') {
            inst = this.parseBranch(operands, lineNum, line, InstructionType.BZ);
        } else if (mnemonic === 'bnz') {
            inst = this.parseBranch(operands, lineNum, line, InstructionType.BNZ);
        } else {
            throw new Error(`未知指令: ${mnemonic}`);
        }

        return { label, instruction: inst, lineContent: line };
    }

    replaceLabels(line: string): string {
        const lineNoComment = this.removeComments(line);
        if (!lineNoComment) return lineNoComment;

        const labelMatch = lineNoComment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)[:\uff1a]\s*(.*)/);
        let labelPart = "";
        let codePart = lineNoComment;
        if (labelMatch) {
            labelPart = labelMatch[1] + ':';
            codePart = labelMatch[2];
        }

        if (!codePart.trim()) return lineNoComment;

        const parts = codePart.split(/\s+/);
        if (parts.length === 0) return lineNoComment;

        const mnemonic = parts[0];
        const operandsStr = parts.slice(1).join(' ');
        const rawOperands = this.splitOperands(operandsStr);
        const newOperands: string[] = [];

        for (const op of rawOperands) {
            if (!op) continue;
            if (this.isImmediate(op)) {
                newOperands.push(op);
            } else if (this.isValidRegister(op)) {
                newOperands.push(op);
            } else if (this.symbols.has(op)) {
                const addr = this.symbols.get(op)!;
                newOperands.push(`${addr}`);
            } else {
                newOperands.push(this.replaceSymbolsInOperand(op));
            }
        }

        return (labelPart + " " + mnemonic + " " + newOperands.join(", ")).trim();
    }

    replaceSymbolsInOperand(operand: string): string {
        return operand.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (identifier) => {
            if (this.isValidRegister(identifier)) {
                return identifier;
            }
            const addr = this.symbols.get(identifier);
            return addr === undefined ? identifier : `${addr}`;
        });
    }

    encodeInstruction(inst: Instruction, currentAddr: number): number {
        const OP_IALU = 0x0;
        const OP_RALU = 0x1;
        const OP_IPCU = 0x2;
        const OP_RPCU = 0x3;
        const OP_IMCU = 0x4;
        const OP_RMCU = 0x5;

        const type = inst.instType;
        const ops = inst.operands;

        if (type === InstructionType.SET) {
            const rd = this.parseRegister(ops[0]);
            const imm = this.parseImmediate(ops[1], 16);
            return (imm << 16) | (rd << 8) | (OP_IALU << 4) | type;
        }

        if ([InstructionType.ADD, InstructionType.SUB, InstructionType.AND,
             InstructionType.OR, InstructionType.XOR, InstructionType.SLL,
             InstructionType.SRL, InstructionType.SRA, InstructionType.MUL,
             InstructionType.DIV, InstructionType.DIVU, InstructionType.REM,
             InstructionType.REMU].includes(type)) {
            const rd = this.parseRegister(ops[0]);
            const rs2 = this.parseRegister(ops[1]);
            const third = ops[2];
            if (this.isImmediate(third)) {
                const imm = this.parseImmediate(third, 16);
                return (imm << 16) | (rs2 << 12) | (rd << 8) | (OP_IALU << 4) | type;
            } else {
                const rs1 = this.parseRegister(third);
                return (rs1 << 16) | (rs2 << 12) | (rd << 8) | (OP_RALU << 4) | type;
            }
        }

        if (type >= InstructionType.LW && type <= InstructionType.SB) {
            const rd = this.parseRegister(ops[0]);
            const rsBase = this.parseRegister(ops[1]);
            const offsetStr = ops[2] || '0';
            const memoryFunction = type - InstructionType.LW;
            if (this.isImmediate(offsetStr)) {
                const imm = this.parseImmediate(offsetStr, 16);
                return (imm << 16) | (rsBase << 12) | (rd << 8) | (OP_IMCU << 4) | memoryFunction;
            } else {
                const rsOffset = this.parseRegister(offsetStr);
                return (rsOffset << 16) | (rsBase << 12) | (rd << 8) | (OP_RMCU << 4) | memoryFunction;
            }
        }

        if (type === InstructionType.JAL) {
            const rd = this.parseRegister(ops[0]);
            const rs2 = this.parseRegister(ops[1]);
            const offset = ops[2];
            if (this.isImmediate(offset)) {
                const imm = this.parseImmediate(offset, 16);
                return (imm << 16) | (rs2 << 12) | (rd << 8) | (OP_IPCU << 4) | 0xC;
            } else if (this.isValidRegister(offset)) {
                const rs1 = this.parseRegister(offset);
                return (rs1 << 16) | (rs2 << 12) | (rd << 8) | (OP_RPCU << 4) | 0xC;
            } else {
                throw new Error(`无效的跳转偏移: ${offset} (应为立即数或寄存器)`);
            }
        }

        if (type === InstructionType.CMP) {
            const condition = Number.parseInt(ops[0], 10);
            const rd = this.parseRegister(ops[1]);
            const rs2 = this.parseRegister(ops[2]);
            const rhs = ops[3];
            if (!Number.isInteger(condition) || condition < 0 || condition > 9) {
                throw new Error(`Invalid comparison condition code: ${ops[0]}`);
            }
            if (this.isImmediate(rhs)) {
                const imm = this.parseImmediate(rhs, 16);
                return (imm << 16) | (rs2 << 12) | (rd << 8) | (OP_IPCU << 4) | condition;
            } else {
                const rs1 = this.parseRegister(rhs);
                return (rs1 << 16) | (rs2 << 12) | (rd << 8) | (OP_RPCU << 4) | condition;
            }
        }

        if (type === InstructionType.BZ || type === InstructionType.BNZ) {
            const rd = this.parseRegister(ops[0]);
            const rs2 = this.parseRegister(ops[1]);
            const offset = ops[2];
            const branchFunction = type === InstructionType.BZ ? 0xA : 0xB;
            if (this.isImmediate(offset)) {
                const imm = this.parseUnsignedImmediate(offset, 16);
                return (imm << 16) | (rs2 << 12) | (rd << 8) | (OP_IPCU << 4) | branchFunction;
            } else if (this.isValidRegister(offset)) {
                const rs1 = this.parseRegister(offset);
                return (rs1 << 16) | (rs2 << 12) | (rd << 8) | (OP_RPCU << 4) | branchFunction;
            } else {
                throw new Error(`Invalid branch target: ${offset} (expected immediate or register)`);
            }
        }

        throw new Error(`未实现的指令类型: ${type}`);
    }

    assemble(sourceCode: string, options: PreprocessOptions = {}): AssemblyResult {
        const preprocessor = new AssemblerPreprocessor();
        const preprocessed = preprocessor.preprocess(sourceCode, options);
        const rawLines = preprocessed.sourceCode.split('\n');
        if (preprocessed.entryLabel) {
            rawLines.unshift(`jmp ${preprocessed.entryLabel} // .entry reset vector`);
        }
        this.symbols = new Map();
        this.errors = [];

        // 第一遍：处理跨行块注释，生成清理后的行
        const lines: string[] = [];
        let inBlockComment = false;
        for (let i = 0; i < rawLines.length; i++) {
            let line = rawLines[i];
            if (inBlockComment) {
                const endIdx = line.indexOf('*/');
                if (endIdx !== -1) {
                    line = line.substring(endIdx + 2);
                    inBlockComment = false;
                } else {
                    lines.push('');
                    continue;
                }
            }
            // 处理行内块注释和开始新块注释
            while (true) {
                const startIdx = line.indexOf('/*');
                if (startIdx === -1) break;
                const endIdx = line.indexOf('*/', startIdx + 2);
                if (endIdx === -1) {
                    line = line.substring(0, startIdx);
                    inBlockComment = true;
                    break;
                }
                line = line.substring(0, startIdx) + line.substring(endIdx + 2);
            }
            // 移除行注释 //
            const lineCommentIdx = line.indexOf('//');
            if (lineCommentIdx !== -1) {
                line = line.substring(0, lineCommentIdx);
            }
            lines.push(line);
        }

        const effectivePreprocessedCode = rawLines.join('\n');

        let byteAddr = preprocessed.origin;
        for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            const cleanLine = lines[lineNum - 1].trim();
            if (!cleanLine) continue;
            const [label, code] = this.extractLabel(cleanLine);
            if (label) {
                if (this.isValidRegister(label)) {
                    this.errors.push(`第 ${lineNum} 行错误: 标签名不能作为寄存器名: ${label}`);
                    continue;
                }
                if (this.symbols.has(label)) {
                    this.errors.push(`第 ${lineNum} 行错误: 重复的标签: ${label}`);
                    continue;
                }
                this.symbols.set(label, byteAddr);
            }
            if (code.trim()) {
                byteAddr += 4;
            }
        }

        if (preprocessed.entryLabel && !this.symbols.has(preprocessed.entryLabel)) {
            this.errors.push(`.entry target label not found: ${preprocessed.entryLabel}`);
        }

        if (this.errors.length) {
            throw new Error(this.errors.join('\n'));
        }

        const processedLines: Array<{ lineNum: number; processed: string; original: string }> = [];
        for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            try {
                const newLine = this.replaceLabels(lines[lineNum - 1]);
                processedLines.push({ lineNum, processed: newLine, original: rawLines[lineNum - 1] });
            } catch (e: any) {
                this.errors.push(`第 ${lineNum} 行错误: ${e.message}`);
            }
        }

        if (this.errors.length) {
            throw new Error(this.errors.join('\n'));
        }

        const replacedCodeLines: string[] = [];
        let pc = preprocessed.origin;
        for (const { processed } of processedLines) {
            const cleanLine = processed.trim();
            if (!cleanLine) continue;
            const [label, code] = this.extractLabel(cleanLine);
            if (label) {
                replacedCodeLines.push(`// --- ${label} ---`);
            }
            if (code.trim()) {
                replacedCodeLines.push(`[${pc.toString().padStart(3, ' ')}\\0x${pc.toString(16).toUpperCase().padStart(4, '0')}] ${code.trim()}`);
                pc += 4;
            }
        }
        const replacedCode = replacedCodeLines.join('\n');

        this.instructions = [];
        const parsedLines: ParsedLine[] = [];
        for (const { lineNum, processed, original } of processedLines) {
            try {
                const parsed = this.parseLine(processed, lineNum);
                parsed.lineContent = original;
                parsedLines.push(parsed);
                if (parsed.instruction) {
                    this.instructions.push(parsed.instruction);
                }
            } catch (e: any) {
                this.errors.push(`第 ${lineNum} 行错误: ${e.message}`);
            }
        }

        if (this.errors.length) {
            throw new Error(this.errors.join('\n'));
        }

        const debugCodeLines: string[] = [];
        debugCodeLines.push("// 调试文件: 去除注释后的汇编代码");
        debugCodeLines.push("// 格式: [PC地址] 代码 (十进制/十六进制)");
        debugCodeLines.push("");
        pc = preprocessed.origin;
        for (const parsed of parsedLines) {
            if (parsed.label) {
                debugCodeLines.push(`// --- ${parsed.label} ---`);
            }
            if (parsed.instruction) {
                const cleanLine = this.removeComments(parsed.lineContent);
                if (cleanLine) {
                    debugCodeLines.push(`[${pc.toString().padStart(3, ' ')}/0x${pc.toString(16).toUpperCase().padStart(4, '0')}] ${cleanLine}`);
                    pc += 4;
                }
            }
        }
        const debugCode = debugCodeLines.join('\n');

        const debugSymbolsLines: string[] = [];
        debugSymbolsLines.push("// 标签地址表");
        debugSymbolsLines.push("// 格式: 标签名 = 地址(十进制) / 地址(十六进制)");
        debugSymbolsLines.push("");
        const sortedSymbols = Array.from(this.symbols.entries()).sort((a, b) => a[1] - b[1]);
        for (const [label, addr] of sortedSymbols) {
            debugSymbolsLines.push(`${label.padEnd(20, ' ')} = ${addr.toString().padStart(3, ' ')} (0x${addr.toString(16).toUpperCase().padStart(4, '0')})`);
        }
        const debugSymbols = debugSymbolsLines.join('\n');

        const machineCodes: number[] = [];
        for (let i = 0; i < this.instructions.length; i++) {
            try {
                const code = this.encodeInstruction(this.instructions[i], i);
                machineCodes.push(code >>> 0);
            } catch (e: any) {
                const inst = this.instructions[i];
                this.errors.push(`第 ${inst.lineNum} 行错误 (${inst.lineContent}): ${e.message}`);
            }
        }

        if (this.errors.length) {
            throw new Error(this.errors.join('\n'));
        }

        return {
            machineCodes,
            debugCode,
            debugSymbols,
            replacedCode,
            programName: preprocessed.programName,
            entryLabel: preprocessed.entryLabel,
            origin: preprocessed.origin,
            preprocessedCode: effectivePreprocessedCode,
        };
    }

}
