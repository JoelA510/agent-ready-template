// Types for scripts/repo-files.mjs, shared by the check scripts.
export declare const SKIP_DIRS: Set<string>
export declare function toPosix(p: string): string
export declare function walk(abs: string, out?: string[]): string[]
export declare function listRepoFiles(root: string): string[]
export declare const SKELETON_MARKER: string
export declare function skeletonDirs(files: string[]): string[]
export declare function inSkeletonDir(dirs: string[]): (relPath: string) => boolean
