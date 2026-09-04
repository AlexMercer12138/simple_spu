export interface CFrontendLimits {
    readonly fileBytes: number;
    readonly totalSourceBytes: number;
    readonly fileCount: number;
    readonly includeDepth: number;
    readonly requestBytes: number;
    readonly resultBytes: number;
    readonly memoryBytes: number;
}

export const HARD_C_FRONTEND_LIMITS: CFrontendLimits = Object.freeze({
    fileBytes: 4 * 1024 * 1024,
    totalSourceBytes: 32 * 1024 * 1024,
    fileCount: 4096,
    includeDepth: 32,
    requestBytes: 40 * 1024 * 1024,
    resultBytes: 64 * 1024 * 1024,
    memoryBytes: 128 * 1024 * 1024,
});
