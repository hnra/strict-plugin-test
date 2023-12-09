import * as ts from 'typescript/lib/tsserverlibrary';

const init: ts.server.PluginModuleFactory = (mod) => {
    const ts = mod.typescript;

    const createProgram = ts.createSemanticDiagnosticsBuilderProgram;

    function create(info: ts.server.PluginCreateInfo) {
        const log = info.project.projectService.logger;

        const proxy = createProxy(info.languageService);
        let program: null | {
            program: ts.SemanticDiagnosticsBuilderProgram;
            host: ts.CompilerHost;
            rootNames: string[];
            options: ts.CompilerOptions;
        } = null;

        proxy.getSemanticDiagnostics = (filePath) => {
            log.info(`Getting semantics for file ${filePath}`);

            if (!program) {
                log.info("Creating initial program");

                // Fallback to language server if program is null?
                const origProg = info.languageService.getProgram()!;

                // Deep copies?
                const rootFiles = [...origProg.getRootFileNames()];
                const options = { ...origProg.getCompilerOptions(), strict: true };
                const compilerHost: ts.CompilerHost = {
                    ...ts.createCompilerHost(options),
                    getSourceFile,
                    getSourceFileByPath: (fileName, filePath, ...args) => getSourceFile(fileName, ...args)
                };

                program = {
                    program: createProgram(rootFiles, options, compilerHost),
                    host: compilerHost,
                    rootNames: rootFiles,
                    options: options
                }
            } else {
                // Always recreate the program?
                program = {
                    ...program,
                    program: createProgram(program.rootNames, program.options, program.host, program.program)
                }
            }

            const diags = program.program.getSemanticDiagnostics(getSourceFile(filePath));

            // Unnecessary copy?
            return [...diags];
        };

        return proxy;

        function getSourceFile(fileName: string, languageVersionOrOptions?: ts.ScriptTarget | ts.CreateSourceFileOptions, onError?: (message: string) => void, shouldCreateNewSourceFile?: boolean): ts.SourceFile | undefined {
            // Does filePath need to be rooted and canonicalized??
            const path = (program?.host.getCanonicalFileName(fileName) ?? fileName) as ts.Path;

            // Should the server project always be used for all files?
            const sourceFile = info.project.getSourceFile(path);
            return sourceFile;
        }
    }

    return {
        create
    };
}

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