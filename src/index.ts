import * as ts from "typescript/lib/tsserverlibrary";

const init: ts.server.PluginModuleFactory = (mod) => {
    const ts = mod.typescript;

    const createProgram = ts.createSemanticDiagnosticsBuilderProgram;

    function create(info: ts.server.PluginCreateInfo) {
        const log = info.project.projectService.logger;

        const proxy = createProxy(info.languageService);
        let state: null | {
            program: ts.SemanticDiagnosticsBuilderProgram;
            host: ts.CompilerHost;
            rootNames: string[];
            options: ts.CompilerOptions;
            originalOptions: ts.CompilerOptions;
        } = null;

        proxy.getSemanticDiagnostics = (filePath) => {
            log.info(`Getting semantics for file ${filePath}`);

            const currentProgram = logPerformance("getProgram", info.languageService.getProgram);

            if (!currentProgram) {
                log.info("currentProgram is null, falling back to language serivce");
                return info.languageService.getSemanticDiagnostics(filePath);
            }

            const rootFiles = [...logPerformance("getRootFileNames", currentProgram.getRootFileNames)];
            const currentOptions = logPerformance("getCompilerOptions", currentProgram.getCompilerOptions);
            const options: ts.CompilerOptions = { ...currentOptions, strict: true };
            const compilerHost: ts.CompilerHost = {
                ...logPerformance("createCompilerHost", () => ts.createCompilerHost(options)),
                getSourceFile,
                getSourceFileByPath: (fileName, filePath, ...args) => getSourceFile(fileName, ...args),
            };

            if (state === null) {
                const program = logPerformance("initial createProgram", () =>
                    createProgram(rootFiles, options, compilerHost),
                );

                state = {
                    program,
                    host: compilerHost,
                    rootNames: rootFiles,
                    options: options,
                    originalOptions: currentOptions,
                };
            } else {
                if (state.originalOptions !== currentOptions) {
                    log.info("Options has changed.");
                }

                const program = logPerformance("incremental createProgram", () =>
                    createProgram(state!.rootNames, state!.options, state!.host, state!.program),
                );

                state = {
                    ...state,
                    program,
                };
            }

            const strictDiags = logPerformance("strict getSemanticDiagnostics", () =>
                state!.program.getSemanticDiagnostics(getSourceFile(filePath)),
            );
            const diags = logPerformance("non-strict getSemanticDiagnostics", () =>
                info.languageService.getSemanticDiagnostics(filePath),
            );

            return strictDiags as ts.Diagnostic[];
        };

        return proxy;

        function getSourceFile(
            fileName: string,
            languageVersionOrOptions?: ts.ScriptTarget | ts.CreateSourceFileOptions,
            onError?: (message: string) => void,
            shouldCreateNewSourceFile?: boolean,
        ): ts.SourceFile | undefined {
            // Does filePath need to be rooted and canonicalized??
            const path = (state?.host.getCanonicalFileName(fileName) ?? fileName) as ts.Path;

            // Should the server project always be used for all files?
            const sourceFile = info.project.getSourceFile(path);
            return sourceFile;
        }

        function logPerformance<T>(title: string, action: () => T) {
            const start = process.hrtime();
            const result = action();
            const end = process.hrtime(start);
            const timeSpentMs = end[1] / 1000000;
            log.info(`Finished '${title}', took: ${timeSpentMs}ms`);
            return result;
        }
    }

    return {
        create,
    };
};

function createProxy<T extends object>(obj: T) {
    const proxy: ts.LanguageService = Object.create(null);
    for (const k of Object.keys(obj) as Array<keyof T>) {
        const x = obj[k]!;
        // @ts-expect-error - JS runtime trickery which is tricky to type tersely
        proxy[k] = (...args: Array<{}>) => x.apply(obj, args);
    }

    return proxy;
}

module.exports = init;
