/*
 * This file is released under the MIT license.
 * Copyright (c) 2017, 2022, Mike Lischke
 *
 * See LICENSE file for more info.
 */

import * as fs from "fs-extra";
import * as crypto from "crypto";
import * as path from "path";

import { ExtensionContext, Uri, window, Webview, commands, ProviderResult, TextDocument } from "vscode";
import { AntlrFacade } from "../backend/facade";
import { ILexicalRange, GrammarType } from "../backend/types";

export interface IRangeHolder {
    range?: ILexicalRange;
}

export class FrontendUtils {

    /**
     * Returns the absolute path to a file located in our misc folder.
     *
     * @param file The base file name.
     * @param context The context of this extension to get its path regardless where it is installed.
     * @param webView When given format the path for use in this webview.
     *
     * @returns The computed path.
     */
    public static getMiscPath(file: string, context: ExtensionContext, webView?: Webview): string {
        if (webView) {
            const uri = Uri.file(context.asAbsolutePath(path.join("misc", file)));

            return webView.asWebviewUri(uri).toString();
        }

        return context.asAbsolutePath(path.join("misc", file));
    }

    /**
     * Returns the absolute path to a file located in our out folder.
     *
     * @param file The base file name.
     * @param context The context of this extension to get its path regardless where it is installed.
     * @param webView When given format the path for use in this webview.
     *
     * @returns The computed path.
     */
    public static getOutPath(file: string, context: ExtensionContext, webView?: Webview): string {
        if (webView) {
            const uri = Uri.file(context.asAbsolutePath(path.join("out", file)));

            return webView.asWebviewUri(uri).toString();
        }

        return context.asAbsolutePath(path.join("out", file));
    }

    /**
     * Returns the absolute path to a file located in the node_modules folder.
     *
     * @param file The base file name.
     * @param context The context of this extension to get its path regardless where it is installed.
     *
     * @returns The computed path.
     */
    public static getNodeModulesPath(file: string, context: ExtensionContext): string {
        return Uri.file(context.asAbsolutePath(path.join("node_modules", file)))
            .with({ scheme: "vscode-resource" }).toString();
    }

    public static isAbsolute(p: string): boolean {
        return path.normalize(p + "/") === path.normalize(path.resolve(p) + "/");
    }

    public static deleteFolderRecursive(target: string): void {
        let files = [];
        if (fs.existsSync(target)) {
            files = fs.readdirSync(target);
            files.forEach((file) => {
                const curPath = path.join(target, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    FrontendUtils.deleteFolderRecursive(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(target);
        }
    }

    public static hashForPath(dataPath: string): string {
        return crypto.createHash("md5").update(dataPath).digest("hex");
    }

    /**
     * Copies all given files to the specified target folder if they don't already exist there
     * or are older than the source files.
     *
     * @param files A list of paths for files to be copied.
     * @param targetPath The target path of the copy operation.
     */
    public static copyFilesIfNewer(files: string[], targetPath: string): void {
        try {
            fs.ensureDirSync(targetPath);
        } catch (error) {
            void window.showErrorMessage(`Could not create target folder '${targetPath}'. ${String(error)}`);
        }

        for (const file of files) {
            try {
                let canCopy = true;
                const targetFile = path.join(targetPath, path.basename(file));
                if (fs.existsSync(targetFile)) {
                    const sourceStat = fs.statSync(file);
                    const targetStat = fs.statSync(targetFile);
                    canCopy = targetStat.mtime < sourceStat.mtime;
                }

                if (canCopy) {
                    void fs.copy(file, targetFile, { overwrite: true });
                }
            } catch (error) {
                void window.showErrorMessage(`Could not copy file '${file}'. ${String(error)}`);
            }
        }
    }

    /**
     * Asks the user for a file to store the given data in. Checks if the file already exists and ask for permission to
     * overwrite it, if so. Also copies a number extra files to the target folder.
     *
     * @param fileName A default file name the user can change, if wanted.
     * @param filters The file type filter as used in showSaveDialog.
     * @param data The data to write.
     * @param extraFiles Files to copy to the target folder (e.g. css).
     */
    public static exportDataWithConfirmation(fileName: string, filters: { [name: string]: string[] }, data: string,
        extraFiles: string[]): void {
        void window.showSaveDialog({
            defaultUri: Uri.file(fileName),
            filters,
        }).then((uri: Uri | undefined) => {
            if (uri) {
                const value = uri.fsPath;
                fs.writeFile(value, data, (error) => {
                    if (error) {
                        void window.showErrorMessage("Could not write to file: " + value + ": " + error.message);
                    } else {
                        this.copyFilesIfNewer(extraFiles, path.dirname(value));
                        void window.showInformationMessage("Diagram successfully written to file '" + value + "'.");
                    }
                });
            }
        });
    }

    /**
     * Given a list of objects which must have a `range` member, finds the entry which covers the given caret position
     * and returns that (or undefined if not found).
     *
     * @param list The list to search through.
     * @param column The position in the target line.
     * @param row The line to search for.
     *
     * @returns The list entry at the given position or undefined if nothing could be found.
     */
    public static findInListFromPosition<T extends IRangeHolder>(list: T[], column: number,
        row: number): T | undefined {
        for (const entry of list) {
            if (!entry.range) {
                continue;
            }

            const start = entry.range.start;
            const stop = entry.range.end;
            let matched = start.row <= row && stop.row >= row;
            if (matched) {
                if (start.row === row) {
                    matched = start.column <= column;
                } else if (stop.row === row) {
                    matched = stop.column >= column;
                }
            }
            if (matched) {
                return entry;
            }
        }
    }

    /**
     * Dynamically switches a vscode context on or off. Such a context is used to enable/disable vscode commands,
     * menus, views and others.
     *
     * @param key The name of the context value to switch.
     * @param enable True or false to enabled/disable.
     *
     * @returns The result returned from the command execution.
     */
    public static switchVsCodeContext(key: string, enable: boolean): ProviderResult<unknown> {
        return commands.executeCommand("setContext", key, enable);
    }

    /**
     * Checks if the given document is actually a grammar file.
     *
     * @param document The document to check.
     *
     * @returns True if this is indeed a grammar file.
     */
    public static isGrammarFile(document?: TextDocument | undefined): boolean {
        return document ? (document.languageId === "antlr" && document.uri.scheme === "file") : false;
    }

    /**
     * Enables/disables certain VS Code contexts depending on which file is currently active.
     *
     * @param backend The facade for details.
     * @param document The source for the updates.
     */
    public static updateVsCodeContext(backend: AntlrFacade, document: TextDocument | undefined): void {
        if (document && FrontendUtils.isGrammarFile(document)) {
            const info = backend.getContextDetails(document.fileName); 1;
            void FrontendUtils.switchVsCodeContext("antlr4.isLexer", info.type === GrammarType.Lexer);
            void FrontendUtils.switchVsCodeContext("antlr4.isParser", info.type === GrammarType.Parser);
            void FrontendUtils.switchVsCodeContext("antlr4.isCombined", info.type === GrammarType.Combined);

            void FrontendUtils.switchVsCodeContext("antlr4.hasImports", info.imports.length > 0);
        }
    }
}
